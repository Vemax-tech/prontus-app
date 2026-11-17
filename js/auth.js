// PRONTUS — autenticação: login, sessão, logout e a guarda das páginas.
//
// QUEM FAZ O QUÊ. A senha é conferida e guardada pelo Supabase Auth (hash bcrypt, limite de
// tentativas, JWT com validade). Este arquivo só fala com ele por HTTP — sem biblioteca, sem
// build — e guarda a sessão. O PAPEL vem da tabela `perfis` (supabase/migrations/0001_perfis.sql),
// lida com o token da própria pessoa: o navegador não escolhe o papel, só o recebe.
//
// O QUE ESTE ARQUIVO NÃO É: a barreira dos dados. Esconder tela é conveniência; quem recusa de
// verdade é a RLS no banco (código 42501). A guarda abaixo existe para a pessoa não ver uma
// página que não vai funcionar para ela.
//
// ONDE FICA A SESSÃO. Em `sessionStorage`: morre ao fechar a aba, não passa para outra aba e some
// no logout. Cookie HttpOnly seria melhor contra roubo por XSS, mas um site estático sem servidor
// próprio não consegue emitir um; a defesa aqui é a CSP fechada em _headers (sem script embutido,
// sem script de terceiros), que é o que impede o XSS de existir.
import { PAPEIS } from './permissoes.js';
import CONFIG_PADRAO from './config.js';

const CHAVE = 'prontus_sessao';
const CHAVE_ATIVIDADE = 'prontus_atividade';
// Num navegador o módulo vem de http(s) e a raiz do app é a pasta acima de js/. Fora dele (testes
// em Node) o módulo é um arquivo local, então a raiz é a do site simulado.
const ROOT = new URL('../', /^https?:/.test(import.meta.url) ? import.meta.url : location.origin + '/js/auth.js');
const LOGIN = new URL('login/', ROOT);
const MARGEM_S = 60;                    // renova o token quando falta menos que isto
const INATIVIDADE_MS = 30 * 60 * 1000;  // tela de clínica esquecida aberta não fica logada para sempre
const TEMPO_LIMITE_MS = 12000;

let cfg = null;
let ir = (url) => location.replace(url);
/** Navegação é um ponto único para os testes poderem observar para onde a página iria. */
export const navegar = (url) => ir(url);
export const aoNavegar = (fn) => { ir = fn; };

/** Para os testes e para quem embute o app: troca o servidor sem mexer em arquivo. */
export function configurar(c) { cfg = c ? { url: String(c.url || '').replace(/\/+$/, ''), anonKey: c.anonKey || '' } : null; }

async function config() {
  if (cfg) return cfg;
  let c = CONFIG_PADRAO;
  // Só em máquina local: lá o arquivo gerado pela stack de desenvolvimento ganha do padrão.
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    try { c = (await import('./config.local.js')).default || c; } catch { /* sem stack local */ }
  }
  configurar(c);
  return cfg;
}
export async function configurado() { const c = await config(); return Boolean(c.url && c.anonKey); }

// ---------------------------------------------------------------- HTTP
/** Devolve { status, corpo }; nunca lança por erro de rede — devolve status 0. */
async function http(caminho, { metodo = 'GET', corpo, token, extra } = {}) {
  const c = await config();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TEMPO_LIMITE_MS);
  try {
    const r = await fetch(c.url + caminho, {
      method: metodo, signal: ctl.signal, cache: 'no-store', credentials: 'omit',
      headers: {
        // Chave publicável nova (sb_publishable_…) não é JWT: vai só em `apikey`; Bearer é só para JWT.
        apikey: c.anonKey,
        ...(token || c.anonKey.startsWith('eyJ') ? { authorization: `Bearer ${token || c.anonKey}` } : {}),
        ...(corpo ? { 'content-type': 'application/json' } : {}),
        ...extra,
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    let json = null;
    try { json = await r.json(); } catch { /* resposta sem corpo */ }
    return { status: r.status, corpo: json };
  } catch { return { status: 0, corpo: null }; } finally { clearTimeout(t); }
}

// ---------------------------------------------------------------- armazenamento da sessão
function ler() {
  try {
    const s = JSON.parse(sessionStorage.getItem(CHAVE) || 'null');
    return s && typeof s.access_token === 'string' && typeof s.refresh_token === 'string' ? s : null;
  } catch { return null; }
}
/** Também usado pelos testes para entrar sem rede. */
export function guardarSessao(s) { try { sessionStorage.setItem(CHAVE, JSON.stringify(s)); } catch { /* sem storage: vale só esta página */ } }
function limpar() { try { sessionStorage.clear(); } catch { /* sem storage */ } }

/** Perfil de quem está logado (síncrono, do que a última checagem guardou). */
export function perfilAtual() {
  const p = ler()?.perfil;
  return p && PAPEIS[p.papel] ? p : null;
}

// ---------------------------------------------------------------- perfil
async function buscarPerfil(token, id) {
  const r = await http(`/rest/v1/perfis?select=id,nome,cargo,papel,ativo&id=eq.${encodeURIComponent(id)}`, { token });
  if (r.status === 0) return { rede: true };
  if (r.status === 401) return { expirou: true };
  const p = Array.isArray(r.corpo) ? r.corpo[0] : null;
  // Sem linha = conta que existe no login mas não foi liberada (ou foi desativada): sem acesso.
  if (!p || p.ativo === false || !PAPEIS[p.papel]) return { semAcesso: true };
  return { perfil: { id: p.id, nome: p.nome, cargo: p.cargo || '', papel: p.papel } };
}

function montarSessao(t, perfil) {
  return {
    access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at: t.expires_at || Math.floor(Date.now() / 1000) + (t.expires_in || 3600),
    perfil: { ...perfil, email: t.user?.email || perfil.email || '' },
  };
}

// ---------------------------------------------------------------- login e logout
/**
 * Confere e-mail e senha. Devolve { perfil } ou { erro } com frase pronta para a tela.
 * A mensagem de credencial errada é uma só, para e-mail e para senha: dizer qual dos dois errou
 * ensina quem tenta adivinhar quais e-mails existem.
 */
export async function entrar(email, senha) {
  if (!await configurado()) return { erro: 'O login ainda não foi configurado neste ambiente. Avise o administrador.' };
  const r = await http('/auth/v1/token?grant_type=password', { metodo: 'POST', corpo: { email: String(email).trim(), password: senha } });
  if (r.status === 0) return { erro: 'Sem conexão com o servidor. Verifique a internet e tente de novo.' };
  if (r.status === 429) return { erro: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' };
  if (r.status === 400 || r.status === 401 || r.status === 422) return { erro: 'E-mail ou senha incorretos.' };
  if (r.status !== 200 || !r.corpo?.access_token) return { erro: 'O servidor de login não respondeu como esperado. Tente de novo em instantes.' };

  const t = r.corpo;
  const p = await buscarPerfil(t.access_token, t.user.id);
  if (p.perfil) {
    guardarSessao(montarSessao(t, p.perfil));
    marcarAtividade();
    return { perfil: p.perfil };
  }
  // Senha certa, mas sem perfil ativo: encerra a sessão que acabou de abrir, para não ficar token solto.
  await http('/auth/v1/logout', { metodo: 'POST', token: t.access_token });
  if (p.semAcesso) return { erro: 'Sua conta ainda não tem acesso ao sistema ou foi desativada. Fale com o administrador.' };
  return { erro: 'Sem conexão com o servidor. Verifique a internet e tente de novo.' };
}

/** Encerra a sessão no servidor (best effort), apaga tudo desta aba e vai para a tela de entrada. */
export async function sair(motivo = '') {
  const s = ler();
  limpar();
  if (s) await http('/auth/v1/logout', { metodo: 'POST', token: s.access_token });
  irParaLogin({ motivo });
}

// ---------------------------------------------------------------- sessão viva
async function renovar(s) {
  const r = await http('/auth/v1/token?grant_type=refresh_token', { metodo: 'POST', corpo: { refresh_token: s.refresh_token } });
  if (r.status === 200 && r.corpo?.access_token) {
    const nova = montarSessao(r.corpo, s.perfil);
    guardarSessao(nova);
    return nova;
  }
  return r.status === 0 ? { rede: true } : null;
}

/** Sessão com token válido, renovando se estiver perto de vencer. null = precisa entrar de novo. */
export async function sessao() {
  let s = ler();
  if (!s) return null;
  if (s.expires_at - Date.now() / 1000 < MARGEM_S) {
    const n = await renovar(s);
    if (n?.rede) return Date.now() / 1000 < s.expires_at ? s : null;
    if (!n) { limpar(); return null; }
    s = n;
  }
  return s;
}

/** Token para chamar o banco. Quem acessar tabelas usa isto; nunca guarde cópia. */
export async function tokenAtual() { return (await sessao())?.access_token || null; }

/**
 * Chamada ao banco (PostgREST) com o token de quem está logado: quem decide o que volta é a RLS.
 * Devolve { status, corpo }; sem sessão, status 401; sem rede, status 0.
 */
export async function api(caminho, { metodo, corpo, extra } = {}) {
  const token = await tokenAtual();
  if (!token) return { status: 401, corpo: null };
  return http(caminho, { metodo, corpo, token, extra });
}

// ---------------------------------------------------------------- navegação e guarda
/**
 * Só aceita caminho DENTRO deste app: `?next=` vindo da URL é entrada de atacante (open redirect).
 *
 * Conferir a origem não basta. `/.//evil.example` tem a origem do site, mas o navegador remove o
 * `/.` e o caminho vira `//evil.example` — e `location.replace('//evil.example')` é um endereço
 * relativo ao protocolo, que sai do site. Por isso o resultado também tem de começar por UMA
 * barra só, e sem barra invertida (que o navegador trata como barra).
 */
export function destinoSeguro(next) {
  try {
    const u = new URL(String(next || ''), location.origin);
    if (u.origin !== location.origin || !u.pathname.startsWith(ROOT.pathname)) return ROOT.pathname;
    if (u.pathname.startsWith(LOGIN.pathname)) return ROOT.pathname;
    const destino = u.pathname + u.search + u.hash;
    if (!/^\/(?![/\\])/.test(destino)) return ROOT.pathname;
    return destino;
  } catch { return ROOT.pathname; }
}

function irParaLogin({ motivo = '', voltar = false } = {}) {
  const u = new URL(LOGIN.href);
  if (motivo) u.searchParams.set('motivo', motivo);
  if (voltar) u.searchParams.set('next', location.pathname + location.search + location.hash);
  navegar(u.href);
}

/**
 * Guarda das páginas: sem sessão válida, a pessoa vai para o login e volta para onde estava.
 * Confere com o servidor a cada abertura de página — token revogado, conta apagada ou desativada
 * e papel trocado pelo administrador valem na hora, não só no próximo login.
 * Devolve o perfil, ou null depois de redirecionar.
 */
export async function exigirSessao() {
  if (!await configurado()) { irParaLogin({ motivo: 'configuracao' }); return null; }
  if (inativo()) { await sair('inatividade'); return null; }
  const tinha = Boolean(ler());
  const s = await sessao();
  // "Expirou" só para quem estava logado; quem abre o endereço pela primeira vez só precisa entrar.
  if (!s) { irParaLogin({ voltar: true, motivo: tinha ? 'expirou' : '' }); return null; }

  const p = await buscarPerfil(s.access_token, s.perfil?.id || '');
  if (p.perfil) {
    guardarSessao({ ...s, perfil: { ...p.perfil, email: s.perfil.email } });
    vigiarInatividade();
    return p.perfil;
  }
  if (p.rede) { vigiarInatividade(); return perfilAtual(); }   // rede caiu: segue com o que já se sabe
  await sair(p.semAcesso ? 'semacesso' : 'expirou');
  return null;
}

/** Já tem sessão? Usado pela tela de login para não pedir senha a quem já entrou. */
export async function jaEntrou() { return Boolean(await configurado() && await sessao() && perfilAtual()); }

// ---------------------------------------------------------------- inatividade
function marcarAtividade() { try { sessionStorage.setItem(CHAVE_ATIVIDADE, String(Date.now())); } catch { /* sem storage */ } }
function inativo() {
  try {
    const t = Number(sessionStorage.getItem(CHAVE_ATIVIDADE));
    return Boolean(ler()) && t > 0 && Date.now() - t > INATIVIDADE_MS;
  } catch { return false; }
}
let vigiando = false;
function vigiarInatividade() {
  if (vigiando) return;
  vigiando = true;
  marcarAtividade();
  let ultimo = 0;
  const tocou = () => { const t = Date.now(); if (t - ultimo > 15000) { ultimo = t; marcarAtividade(); } };
  for (const ev of ['pointerdown', 'keydown', 'scroll']) window.addEventListener(ev, tocou, { passive: true });
  window.setInterval(() => { if (inativo()) sair('inatividade'); }, 30000);
}
