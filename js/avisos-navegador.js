// PRONTUS — o sistema chamando quem precisa agir.
//
// POR QUE ISTO FALTAVA.
// js/atualiza.js já percebe que a fila mudou enquanto a tela está aberta. Mas perceber não é
// avisar: a faixa discreta só alcança quem está olhando, e quem está olhando é justamente quem
// não precisa ser chamado. Enquanto o sistema só respondesse a quem entrasse nele, o grupo do
// WhatsApp continuaria sendo o despertador da clínica — e sair disso é o objetivo do projeto.
//
// TRÊS AVISOS, DO MAIS DISCRETO AO MAIS INSISTENTE:
//   1. o número no TÍTULO DA ABA — funciona com a aba em segundo plano e não pede permissão;
//   2. o PONTO NO ÍCONE DA ABA, para quem acha a aba pelo desenho e não lê o título;
//   3. a NOTIFICAÇÃO DO SISTEMA, que aparece por cima de tudo. Só depois de a pessoa ligar, uma
//      vez, no próprio sininho. Nunca pedimos permissão ao abrir a página: pedido sem contexto é
//      negado, e o navegador não deixa pedir de novo.
//
// NADA DISSO SAI DA MÁQUINA. Não existe servidor de push nem endereço externo: é o navegador
// avisando o próprio usuário, com dados que já estão na tela. Em produção, com o tempo real do
// Supabase, muda só quem puxa o gatilho — estas funções continuam as mesmas.
//
// O QUE O AVISO DIZ: o papel, quantos casos e o que fazer. NUNCA o nome do paciente nem o relato.
// A notificação aparece na tela de bloqueio e na frente de quem passar pelo balcão; dado clínico
// não tem por que estar ali, e o caso inteiro está a um clique de distância.

const CHAVE_PREF = 'prontus.avisos.navegador';

// Cores escritas à mão, e não tokens: o ícone da aba é desenhado fora do documento, onde não
// existe CSS para consultar. São as mesmas do favicon.svg e do --crit do tema claro.
const PETROLEO = '#0E4B57';
const CLARO = '#F3F5F4';
const ALERTA = '#BC2342';

let base = typeof document === 'undefined' ? '' : document.title;
let pendentes = 0;
let elo = null;        // <link rel="icon"> que trocamos, criado na primeira vez

/** O título "limpo" da página. A casca chama isto no lugar de mexer em document.title. */
export function definirTitulo(t) {
  base = t;
  aplicar();
}

/** Quantos itens esperam a pessoa. Zero devolve o título e o ícone ao normal. */
export function marcar(n) {
  const novo = Math.max(0, Number(n) || 0);
  if (novo === pendentes) return;
  pendentes = novo;
  aplicar();
}

function aplicar() {
  if (typeof document === 'undefined') return;
  document.title = pendentes ? `(${pendentes > 9 ? '9+' : pendentes}) ${base}` : base;
  pintarIcone();
}

/**
 * Redesenha o ícone da aba com um ponto vermelho. O ícone é um SVG montado aqui, com conteúdo
 * fixo — nada que venha do usuário entra nele —, e a política de conteúdo permite `data:` em
 * imagem, que é como o navegador carrega um favicon escrito em linha.
 */
function pintarIcone() {
  if (typeof document === 'undefined') return;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
    + `<rect width="24" height="24" rx="5" fill="${PETROLEO}"/>`
    + `<g fill="none" stroke="${CLARO}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">`
    + '<path d="M7 15.4h3.1a2 2 0 0 0 2-2v-3a2 2 0 0 1 2-2H17"/></g>'
    + (pendentes ? `<circle cx="18" cy="6" r="5.5" fill="${ALERTA}" stroke="${CLARO}" stroke-width="1.6"/>` : '')
    + '</svg>';
  try {
    if (!elo) {
      elo = document.querySelector('link[rel~="icon"]') || document.head.appendChild(
        Object.assign(document.createElement('link'), { rel: 'icon', type: 'image/svg+xml' }));
    }
    elo.setAttribute('type', 'image/svg+xml');
    elo.setAttribute('href', 'data:image/svg+xml,' + encodeURIComponent(svg));
  } catch { /* aba sem head utilizável: o título já avisa */ }
}

// ---------------------------------------------------------------- notificação do sistema

const temApi = () => typeof window !== 'undefined' && 'Notification' in window;
const permissao = () => (temApi() ? Notification.permission : 'unsupported');

const preferiu = () => {
  try { return localStorage.getItem(CHAVE_PREF) === '1'; } catch { return false; }
};
const guardar = (v) => {
  try { localStorage.setItem(CHAVE_PREF, v ? '1' : '0'); } catch { /* sem storage: vale esta aba */ }
};

/**
 * Em que pé está o aviso do sistema, numa palavra:
 *   'indisponivel' — o navegador não tem a função (acontece em aba antiga e em jsdom);
 *   'negado'       — a pessoa recusou. Não insistimos: o navegador nem deixaria perguntar;
 *   'desligado'    — dá para ligar;
 *   'ligado'       — permitido E escolhido aqui dentro. As duas condições, porque permitir uma
 *                    vez no navegador não é o mesmo que querer ser interrompido por este sistema.
 */
export function estado() {
  if (!temApi()) return 'indisponivel';
  const p = permissao();
  if (p === 'denied') return 'negado';
  return p === 'granted' && preferiu() ? 'ligado' : 'desligado';
}

/** Liga, pedindo permissão se ainda não houver. Devolve o estado novo. */
export async function ligar() {
  if (!temApi()) return 'indisponivel';
  if (permissao() === 'default') {
    try { await Notification.requestPermission(); } catch { /* recusa vale como recusa */ }
  }
  if (permissao() !== 'granted') return estado();
  guardar(true);
  return 'ligado';
}

export function desligar() {
  guardar(false);
  return estado();
}

/**
 * Mostra uma notificação. `tag` faz a nova SUBSTITUIR a anterior do mesmo assunto em vez de
 * empilhar: dez casos chegando viram um aviso que conta dez, não dez avisos.
 * Clicar traz a aba para a frente e abre o endereço.
 */
export function notificar({ titulo, corpo, url, tag = 'prontus' }) {
  if (estado() !== 'ligado') return null;
  try {
    const n = new Notification(titulo, { body: corpo, tag, renotify: false });
    n.onclick = () => {
      try { window.focus(); } catch { /* sem foco: o clique ainda navega */ }
      // Só endereço do próprio site: a notificação é do sistema operacional e o `url` vem de quem a chamou.
      try { if (url && new URL(url, location.href).origin === location.origin) location.assign(url); } catch { /* endereço inválido: só fecha */ }
      n.close();
    };
    return n;
  } catch { return null; }
}
