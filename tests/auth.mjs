// Teste de ponta a ponta do login, contra o servidor de verdade (Supabase Auth + Postgres + RLS).
//
// Diferente de tests/telas.mjs, aqui NADA é simulado no servidor: as senhas são conferidas pelo
// GoTrue, os papéis vêm da tabela `perfis` e as recusas são da RLS. O navegador é o jsdom.
//
// Pré-requisito (uma vez):  cd supabase/local && docker compose up -d && cd ../.. && node supabase/local/preparar.mjs
// Rodar:                    npm run test:auth
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { anonKey, servicoKey, CONTAS, SENHA_LOCAL, URL_LOCAL } from '../supabase/local/contas.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const falhas = [];
const check = (c, m) => { if (!c) { falhas.push(m); console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const vc = new VirtualConsole();
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost:3005/solicitacoes/', virtualConsole: vc, pretendToBeVisual: true });
for (const k of ['window', 'document', 'navigator', 'location', 'Element', 'Node', 'HTMLElement', 'Event']) {
  Object.defineProperty(globalThis, k, { value: dom.window[k], writable: true, configurable: true });
}
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.localStorage = dom.window.localStorage;

const A = await import(pathToFileURL(path.join(REPO, 'js/auth.js')).href);
A.configurar({ url: URL_LOCAL, anonKey });
let destino = null;
A.aoNavegar((u) => { destino = u; });
const guardado = () => JSON.parse(sessionStorage.getItem('prontus_sessao') || 'null');
const psql = (sql) => spawnSync('docker', ['exec', 'prontus-auth-db-1', 'psql', '-U', 'postgres', '-d', 'prontus', '-t', '-A', '-c', sql], { encoding: 'utf8' }).stdout.trim();
const rest = async (caminho, { token, metodo = 'GET', corpo } = {}) => {
  const r = await fetch(URL_LOCAL + '/rest/v1/' + caminho, {
    method: metodo,
    headers: { apikey: anonKey, authorization: `Bearer ${token || anonKey}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};

try { await fetch(URL_LOCAL + '/auth/v1/health'); } catch {
  console.log('✗ A stack local de login não está no ar. Rode: cd supabase/local && docker compose up -d && cd ../.. && node supabase/local/preparar.mjs');
  process.exit(1);
}

// A auditoria de contas é imutável; o que este teste gravar nela, ele mesmo apaga no fim (só o dono
// do banco local consegue, desligando os gatilhos da sessão).
const marcoAuditoria = Number(psql('select coalesce(max(id), 0) from public.auditoria_contas')) || 0;

// ================================================================ credenciais
console.log('\n## Login: senha conferida pelo servidor');
let r = await A.entrar('admin@prontus.local', 'senha-errada-123');
check(r.erro === 'E-mail ou senha incorretos.' && !guardado(), 'senha errada é recusada e nenhuma sessão é guardada');
const r2 = await A.entrar('naoexiste@prontus.local', 'qualquer-senha-123');
check(r2.erro === r.erro, 'e-mail que não existe recebe a MESMA frase (não revela quais e-mails existem)');
check(!JSON.stringify({ ...sessionStorage }).includes(SENHA_LOCAL), 'a senha não fica em nenhum lugar do armazenamento');

for (const [email, nome, , papel] of CONTAS) {
  A.aoNavegar((u) => { destino = u; });
  sessionStorage.clear();
  r = await A.entrar(email, SENHA_LOCAL);
  check(r.perfil?.papel === papel && r.perfil?.nome === nome, `${papel}: entra e o papel vem do banco (${r.perfil?.nome})`);
  check(guardado()?.perfil?.papel === papel && guardado().access_token.split('.').length === 3, `${papel}: sessão guardada com JWT`);
}

// ================================================================ papel não é escolha do navegador
console.log('\n## O papel não é decidido pelo navegador');
sessionStorage.clear();
await A.entrar('callcenter@prontus.local', SENHA_LOCAL);
const s = guardado();
sessionStorage.setItem('prontus_sessao', JSON.stringify({ ...s, perfil: { ...s.perfil, papel: 'admin' } }));
check(A.perfilAtual().papel === 'admin', '(o armazenamento adulterado engana só o que é lido localmente)');
const p = await A.exigirSessao();
check(p?.papel === 'callcenter' && A.perfilAtual().papel === 'callcenter', 'a próxima página confere no servidor e desfaz a adulteração');
let t = await rest('perfis?select=id,papel', { token: s.access_token });
check(t.status === 200 && t.json.length === 1 && t.json[0].papel === 'callcenter', 'RLS: o Call Center enxerga só o próprio perfil');
t = await rest(`perfis?id=eq.${s.perfil.id}`, { token: s.access_token, metodo: 'PATCH', corpo: { papel: 'admin' } });
check(psql(`select papel from perfis where id='${s.perfil.id}'`) === 'callcenter', 'RLS: tentar virar admin pelo próprio token não muda nada no banco');
t = await rest('perfis?select=id');
check(t.status === 401 || t.status === 403 || (Array.isArray(t.json) && t.json.length === 0), 'sem login, a tabela de perfis não devolve nada');

sessionStorage.clear();
await A.entrar('admin@prontus.local', SENHA_LOCAL);
const adm = guardado();
t = await rest('perfis?select=id', { token: adm.access_token });
check(t.json?.length === CONTAS.length, 'RLS: o administrador enxerga todos os perfis');
t = await rest(`perfis?id=eq.${adm.perfil.id}`, { token: adm.access_token, metodo: 'PATCH', corpo: { ativo: false } });
check(t.status >= 400 && /administrador ativo/.test(JSON.stringify(t.json)) && psql(`select ativo from perfis where id='${adm.perfil.id}'`) === 't',
  'ninguém desativa o último administrador (nem ele mesmo)');

// ================================================================ conta desativada
console.log('\n## Conta sem acesso');
const arq = CONTAS.find((c) => c[3] === 'arquivo')[0];
psql(`update perfis set ativo=false where papel='arquivo'`);
sessionStorage.clear();
r = await A.entrar(arq, SENHA_LOCAL);
check(/sem acesso|desativada/.test(r.erro || '') && !guardado(), 'conta desativada com senha certa não entra e não deixa token guardado');
psql(`update perfis set ativo=true where papel='arquivo'`);

await A.entrar(CONTAS[1][0], SENHA_LOCAL);
psql(`update perfis set ativo=false where papel='callcenter'`);
destino = null;
const pp = await A.exigirSessao();
check(pp === null && /login\//.test(destino || '') && !guardado(), 'desativada depois de entrar: a próxima página já expulsa para o login');
psql(`update perfis set ativo=true where papel='callcenter'`);

// ================================================================ sessão: renovação, logout, guarda
console.log('\n## Sessão, renovação e logout');
sessionStorage.clear();
await A.entrar('recepcao@prontus.local', SENHA_LOCAL);
const antes = guardado();
sessionStorage.setItem('prontus_sessao', JSON.stringify({ ...antes, expires_at: Math.floor(Date.now() / 1000) + 5 }));
const renovada = await A.sessao();
check(renovada && renovada.refresh_token !== antes.refresh_token && renovada.expires_at > Date.now() / 1000 + 600, 'token perto de vencer é renovado sozinho');

destino = null;
const velho = guardado();
await A.sair('saiu');
check(!guardado() && sessionStorage.length === 0, 'logout apaga tudo desta aba');
check(/login\/\?motivo=saiu/.test(destino || ''), 'e leva para a tela de entrada');
const reuso = await fetch(URL_LOCAL + '/auth/v1/token?grant_type=refresh_token', {
  method: 'POST', headers: { apikey: anonKey, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: velho.refresh_token }),
});
check(reuso.status >= 400, 'o refresh token foi revogado no servidor: copiar a sessão antiga não funciona');

destino = null;
check(await A.exigirSessao() === null && /login\/\?next=%2Fsolicitacoes%2F/.test(destino || ''), 'página protegida sem sessão vai ao login e guarda para onde voltar');

sessionStorage.setItem('prontus_sessao', JSON.stringify({ ...velho, access_token: velho.access_token.slice(0, -4) + 'abcd', expires_at: 9e9 }));
destino = null;
await A.exigirSessao();
check(/login\//.test(destino || '') && !guardado(), 'token adulterado não passa na guarda');

// ================================================================ redirecionamento seguro
console.log('\n## ?next= não vira redirecionamento aberto');
for (const ruim of ['https://evil.example/', '//evil.example', 'javascript:alert(1)', '/login/', 'http://localhost:3005.evil.example/', '',
  // o navegador normaliza estes para `//evil.example`, que SAI do site: a origem confere, o resultado não pode valer
  '/.//evil.example/x', '/..//evil.example', '/%2e//evil.example', '/./\\evil.example', '/\\evil.example', '/\t/evil.example']) {
  const d = A.destinoSeguro(ruim);
  check(d === '/' , `recusa ${JSON.stringify(ruim)} → ${d}`);
}
check(A.destinoSeguro('/solicitacoes/detalhe.html?id=sol-0003') === '/solicitacoes/detalhe.html?id=sol-0003', 'aceita caminho do próprio app, com parâmetros');

// ================================================================ concorrência
console.log('\n## Último administrador, com duas alterações simultâneas');
const psqlAsync = (sql) => new Promise((res) => {
  const p = spawn('docker', ['exec', '-i', 'prontus-auth-db-1', 'psql', '-U', 'postgres', '-d', 'prontus', '-t', '-A', '-c', sql]);
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('close', (c) => res({ c, out, err }));
});
const ID_ADM = psql(`select id from perfis where papel='admin' limit 1`);
psql(`insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin2@prontus.local', now(), now()) on conflict do nothing`);
psql(`insert into perfis (id, nome, papel) values ('00000000-0000-0000-0000-0000000000a2', 'Segundo Admin', 'admin') on conflict (id) do update set papel='admin', ativo=true`);
// A primeira transação rebaixa um admin e segura a transação aberta; a segunda tenta rebaixar o outro.
const [t1, t2] = await Promise.all([
  psqlAsync(`begin; update perfis set ativo=false where id='${ID_ADM}'; select pg_sleep(2); commit;`),
  new Promise((x) => setTimeout(x, 700)).then(() => psqlAsync(`update perfis set ativo=false where id='00000000-0000-0000-0000-0000000000a2'`)),
]);
const ativos = Number(psql(`select count(*) from perfis where papel='admin' and ativo`));
check(ativos >= 1, `a clínica nunca fica sem administrador ativo (restaram ${ativos})`);
check(t1.c === 0 && t2.c !== 0 && /administrador ativo/.test(t2.err), 'a segunda alteração espera a primeira e é recusada');
psql(`update perfis set ativo=true where papel='admin'`);
psql(`delete from auth.users where id='00000000-0000-0000-0000-0000000000a2'`);

// ================================================================ a tela
console.log('\n## Tela de login');
const L = await import(pathToFileURL(path.join(REPO, 'js/modules/login.js')).href);
const app = () => dom.window.document.getElementById('app');
const clicar = (el) => el.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
const enviar = () => app().querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
const esperar = async (cond) => { for (let i = 0; i < 60 && !cond(); i++) await new Promise((x) => setTimeout(x, 100)); };
dom.window.history.replaceState({}, '', '/login/?next=%2Frelatorios%2F');
await L.init();
check(Boolean(app().querySelector('input[type=email][autocomplete=username]')) && Boolean(app().querySelector('input[type=password][autocomplete=current-password]')), 'campos de e-mail e senha com autocomplete correto');
enviar();
check(/Informe o e-mail/.test(app().textContent) && /Informe a senha/.test(app().textContent) && app().querySelector('#email').getAttribute('aria-invalid') === 'true', 'vazio: aponta os dois campos e marca aria-invalid');
app().querySelector('#email').value = 'isso-nao-e-email'; app().querySelector('#senha').value = 'x';
enviar();
check(/não parece certo/.test(app().textContent), 'e-mail malformado é barrado antes de ir ao servidor');
app().querySelector('#email').value = 'admin@prontus.local'; app().querySelector('#senha').value = 'errada-errada';
enviar();
await esperar(() => /incorretos/.test(app().textContent));
check(/E-mail ou senha incorretos/.test(app().textContent) && app().querySelector('#senha').value === '', 'senha errada: mensagem clara e o campo de senha é limpo');
check(app().querySelector('[role=alert]:not([hidden])') !== null, 'a mensagem é anunciada a leitor de tela (role=alert)');
const ver = app().querySelector('.ver');
clicar(ver);
check(app().querySelector('#senha').type === 'text', 'o botão mostra a senha digitada');
clicar(ver);
destino = null;
app().querySelector('#email').value = 'admin@prontus.local'; app().querySelector('#senha').value = SENHA_LOCAL;
enviar();
await esperar(() => destino);
check(destino === '/relatorios/', `senha certa: segue para onde a pessoa estava (${destino})`);
check(guardado()?.perfil?.papel === 'admin', 'e a sessão ficou guardada com o papel do banco');
destino = null;
await L.init();
check(destino === '/relatorios/', 'quem já entrou e abre o login é mandado adiante, sem digitar de novo');

// ================================================================ contas (administrador)
console.log('\n## Contas reais: só o administrador, e tudo fica registrado');
const C = await import(pathToFileURL(path.join(REPO, 'js/contas.js')).href);
const como = async (email) => { sessionStorage.clear(); await A.entrar(email, SENHA_LOCAL); return guardado(); };
const psqlErro = (sql) => spawnSync('docker', ['exec', 'prontus-auth-db-1', 'psql', '-U', 'postgres', '-d', 'prontus', '-c', sql], { encoding: 'utf8' }).stderr;

// quem não é administrador
let quem = await como('recepcao@prontus.local');
let l = await C.listarContas();
check(l.error?.code === '42501', 'a Recepção não lista as contas (o banco recusa com 42501)');
let up = await C.atualizarPerfil(quem.perfil.id, { nome: 'Outro Nome' });
check(up.error?.code === '42501' && psql(`select nome from perfis where id='${quem.perfil.id}'`) !== 'Outro Nome', 'nem edita o próprio perfil (a RLS filtra e a recusa é explícita)');
t = await rest('auditoria_contas?select=id', { token: quem.access_token });
check(t.status === 200 && t.json.length === 0, 'a trilha de contas não devolve nenhuma linha a quem não é administrador');
t = await rest('rpc/liberar_conta', { token: quem.access_token, metodo: 'POST', corpo: { p_id: quem.perfil.id, p_nome: 'Zé', p_cargo: '', p_papel: 'admin' } });
check(t.status >= 400 && /Só o Administrador|já tem perfil/.test(JSON.stringify(t.json)), 'e não libera conta');
t = await rest('rpc/usuarios_da_clinica', { metodo: 'POST', corpo: {} });
check(t.status >= 400, 'sem login, a lista de contas é recusada');

// o administrador
quem = await como('admin@prontus.local');
const adm2 = quem;
l = await C.listarContas();
check(!l.error && l.data.length >= CONTAS.length && l.data.every((c) => c.email), 'o administrador lista as contas, com e-mail');
check(!/password|encrypted|hash|token/i.test(JSON.stringify(l.data)), 'e a lista não traz senha, hash nem token');

const emailNovo = `pendente-${Date.now()}@prontus.local`;
const criada = await (await fetch(URL_LOCAL + '/auth/v1/admin/users', {
  method: 'POST', headers: { apikey: anonKey, authorization: `Bearer ${servicoKey}`, 'content-type': 'application/json' },
  body: JSON.stringify({ email: emailNovo, password: SENHA_LOCAL, email_confirm: true }),
})).json();
l = await C.listarContas();
const pend = l.data.find((c) => c.id === criada.id);
check(Boolean(pend) && !pend.temPerfil && !pend.ativo && l.data[0].id === criada.id, 'conta criada no login e sem perfil aparece primeiro, como aguardando liberação');
r = await A.entrar(emailNovo, SENHA_LOCAL);
check(/sem acesso|desativada|não tem acesso/i.test(r.erro || ''), 'e enquanto não for liberada, a pessoa não entra');

quem = await como('admin@prontus.local');
let lib = await C.liberarConta({ id: criada.id, nome: '  Pessoa Teste  ', cargo: '', papel: 'arquivo' });
check(!lib.error && psql(`select nome||'|'||coalesce(cargo,'-')||'|'||papel from perfis where id='${criada.id}'`) === 'Pessoa Teste|-|arquivo', 'liberar cria o perfil (nome aparado, cargo vazio vira nulo)');
lib = await C.liberarConta({ id: criada.id, nome: 'Outra', cargo: '', papel: 'admin' });
check(lib.error && /já tem perfil/.test(lib.error.message), 'liberar duas vezes não sobrescreve o perfil');
up = await C.atualizarPerfil(criada.id, { papel: 'root' });
check(up.error?.code === '23514', 'papel fora da lista é recusado pelo banco');
up = await C.atualizarPerfil(criada.id, { id: quem.perfil.id, criado_em: '2000-01-01', papel: 'recepcao', cargo: 'Recepção noturna' });
check(!up.error && up.data.id === criada.id && up.data.papel === 'recepcao', 'trocar papel e cargo funciona, e campos fora da lista (id, criado_em) são ignorados');
up = await C.atualizarPerfil(criada.id, { ativo: false });
check(!up.error && psql(`select ativo from perfis where id='${criada.id}'`) === 'f', 'desativar funciona');
r = await A.entrar(emailNovo, SENHA_LOCAL);
check(/sem acesso|desativada|não tem acesso/i.test(r.erro || ''), 'e a conta desativada deixa de entrar');

quem = await como('admin@prontus.local');
const aud = await C.listarAuditoriaContas(40);
const dela = (aud.data || []).filter((a) => a.alvo_id === criada.id);
check(['perfil_criado', 'papel_alterado', 'perfil_editado', 'desativado'].every((a) => dela.some((x) => x.acao === a)), 'cada alteração virou uma linha na auditoria de contas');
check(dela.length > 0 && dela.every((x) => x.ator_id === adm2.perfil.id), 'quem agiu vem do token do banco, não de algo que o navegador informa');
const editado = dela.find((x) => x.acao === 'perfil_editado');
check(JSON.stringify(editado?.detalhe) === '{"campos":["cargo"]}', 'a edição registra QUAIS campos mudaram, sem copiar o conteúdo');
check(dela.find((x) => x.acao === 'papel_alterado')?.detalhe?.de === 'arquivo' && dela.find((x) => x.acao === 'papel_alterado')?.detalhe?.para === 'recepcao', 'a troca de papel registra de onde e para onde');

// imutável
t = await rest(`auditoria_contas?alvo_id=eq.${criada.id}`, { token: quem.access_token, metodo: 'DELETE' });
check(t.status >= 400, 'nem o administrador apaga a auditoria pela API');
t = await rest(`auditoria_contas?alvo_id=eq.${criada.id}`, { token: quem.access_token, metodo: 'PATCH', corpo: { acao: 'reativado' } });
check(t.status >= 400, 'nem altera');
t = await rest('auditoria_contas', { token: quem.access_token, metodo: 'POST', corpo: { acao: 'perfil_criado', alvo_id: criada.id } });
check(t.status >= 400, 'nem escreve uma linha por conta própria (só o gatilho escreve)');
check(/não pode ser alterada/.test(psqlErro(`delete from public.auditoria_contas where alvo_id='${criada.id}'`)), 'e o próprio banco, até para o dono da tabela, recusa apagar ou alterar');

// apagar a conta no login remove o perfil, e isso também fica registrado
await fetch(`${URL_LOCAL}/auth/v1/admin/users/${criada.id}`, { method: 'DELETE', headers: { apikey: anonKey, authorization: `Bearer ${servicoKey}` } });
check(psql(`select count(*) from public.auditoria_contas where alvo_id='${criada.id}' and acao='perfil_removido'`) === '1', 'remover a conta no login deixa o "perfil removido" na auditoria');

// limpeza: só o que este teste gravou
psql(`set session_replication_role = replica; delete from public.auditoria_contas where id > ${marcoAuditoria}`);
check(psql('select count(*) from public.auditoria_contas where id > ' + marcoAuditoria) === '0', '(limpeza do que o teste gravou na auditoria local)');

console.log('');
if (falhas.length) { console.log(`✗ ${falhas.length} falha(s)`); falhas.forEach((f) => console.log(' - ' + f)); process.exit(1); }
console.log('✓ login de ponta a ponta passou');
process.exit(0);
