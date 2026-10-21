// PRONTUS — casca da aplicação e peças visuais do sistema.
//
// Monta a barra superior, a navegação por papel, a faixa de demonstração e o quadro de conteúdo,
// e entrega às telas um contexto (ctx) com quem é o usuário e o que ele pode. As peças de interface
// genéricas vêm de ./base/ (sem conhecimento de domínio); o que é identidade do Prontus está aqui
// e no CSS de css/.
import { criarIcon, criarRun, empty as emptyBase, h, toast } from './base/dom.js';
import { papelAtual, definirPapel, papeisAtuais, atorAtual, PAPEIS } from './papel.js';
import { pode, podeCompleto } from './permissoes.js';
import { nomeDe, usuarioPor, reiniciar } from './dados.js';
import { dadosDasFilas, contarFilas } from './filas.js';
import { MARCA, MONOGRAMA } from './marca.js';

export { instalarDom, h, fmtDate, linkSeguro, toast, copyText, modal, confirmDlg, formModal, tabs, qs } from './base/dom.js';
export { dataTable, filtros, contem, baixarCsv } from './base/tabela.js';

const ROOT = new URL('../', import.meta.url).href;

// Ícones (Lucide). Conteúdo fixo, escrito aqui — nunca vindo de dado do usuário.
const ICONS = {
  marca: MONOGRAMA,
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  archive: '<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9M10 13h4"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  check: '<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  arrow: '<path d="M5 12h14M13 5l7 7-7 7"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
};
export const icon = criarIcon(ICONS, 'marca');
export const empty = (msg) => emptyBase(msg, icon('inbox'));
export const run = criarRun(() => toast('O servidor recusaria esta ação: ela não é do seu papel.', true));

// ---------------------------------------------------------------- peças visuais do sistema

/** Etiqueta de estado: retângulo discreto com ponto colorido. O texto sempre acompanha a cor. */
export const badge = (texto, tipo = '') => h('span', { class: 'tag' + (tipo ? ' ' + tipo : '') }, texto);

/** Seção com título. */
export const sec = (titulo, ...kids) => h('section', { class: 'sec' }, h('h2', {}, titulo), ...kids);

/**
 * Indicador: rótulo, número e CRITÉRIO DE CONTAGEM. O critério não é opcional de propósito —
 * número sem critério é opinião, e quem lê o painel precisa saber o que entrou na conta.
 * `tipo`: '' | 'ok' | 'warn' | 'crit'. `href`/`onclick` transformam o indicador em atalho.
 */
export function stat({ k, v, c, tipo = '', href, onclick, on }) {
  const cls = 'stat' + (tipo ? ' ' + tipo : '') + (on ? ' on' : '');
  const kids = [h('span', { class: 'k' }, k), h('b', {}, String(v)), c && h('span', { class: 'c' }, c)];
  if (href) return h('a', { class: cls, href }, kids);
  if (onclick) return h('button', { class: cls, type: 'button', onclick }, kids);
  return h('div', { class: cls }, kids);
}
/** Linha de indicadores: um painel dividido por fios, não vários cartões soltos. */
export const stats = (...kids) => h('div', { class: 'stats' }, kids);

/** Barra de magnitude: uma série, cor constante, comprimento proporcional. */
export const barra = (n, max, tipo = '') => h('div', { class: 'bar' + (tipo ? ' ' + tipo : ''), role: 'presentation' },
  h('i', { style: `width:${max > 0 ? Math.max(2, Math.round((n / max) * 100)) : 0}%` }));

/** Linha "rótulo · barra · valor", para comparar quantidades numa lista. */
export const rowbar = (rotulo, n, max, { tipo = '', valor } = {}) => h('div', { class: 'rowbar' },
  h('span', {}, rotulo), barra(n, max, tipo), h('b', {}, valor ?? String(n)));

/** Observação em texto, com barra lateral. `tipo`: '' | 'warn' | 'info'. */
export const nota = (tipo, ...kids) => h('p', { class: 'note' + (tipo ? ' ' + tipo : '') }, kids);

/** Cabeçalho de página: olho, título, explicação e ações à direita. */
export const pageHead = (olho, titulo, sub, ...acoes) => h('div', { class: 'head' },
  h('div', {}, h('p', { class: 'eyebrow' }, olho), h('h1', {}, titulo), sub && h('p', { class: 'muted' }, sub)),
  h('div', { class: 'row' }, acoes));

// ---------------------------------------------------------------- navegação
// [pasta, rótulo, ícone, recurso exigido (null = todos), separador antes]
const NAV = [
  ['', 'Visão geral', 'home', 'dashboard', false],
  ['filas/', 'Fila atual', 'inbox', 'tarefa_ver', false],
  ['minhafila/', 'Minha fila', 'check', 'tarefa_ver', false],
  ['solicitacoes/', 'Solicitações', 'list', 'solicitacao_ver', false],
  ['prontuarios/', 'Prontuários', 'archive', 'prontuario_ver', false],
  ['registros/', 'Documentos', 'file', 'comunicacao_ver', false],
  ['relatorios/', 'Relatórios', 'chart', 'relatorios', true],
  ['permissoes/', 'Permissões', 'shield', null, false],
];

/** Assinatura da marca: serifa na palavra, monograma em petróleo. */
const assinatura = () => h('a', { class: 'mark', href: ROOT, 'aria-label': `${MARCA.produto} — início` },
  icon('marca'), h('span', {}, MARCA.produto), h('em', {}, MARCA.descritor));

/** Faixa de demonstração: uma linha, sempre visível, não fechável. */
const faixaDemo = () => h('div', { class: 'demo', role: 'note' },
  icon('alert'),
  h('span', {}, h('b', {}, 'Demonstração'), ' — dados fictícios em memória. Nada é salvo e nenhum paciente real existe aqui.'),
  h('span', { class: 'sep', 'aria-hidden': 'true' }, '|'),
  h('span', {}, 'Em produção as regras e as permissões vivem no banco, não no navegador.'),
  h('button', { class: 'linkbtn', onclick: async () => { await reiniciar(); location.reload(); } }, 'Reiniciar dados'));

/**
 * Quem está usando o sistema. NA DEMONSTRAÇÃO é um seletor, para mostrar as visões sem login.
 * EM PRODUÇÃO vira o nome de quem entrou, e o papel chega pela sessão autenticada (ver papel.js).
 */
function quemSouEu() {
  const atual = papelAtual();
  const u = usuarioPor(atorAtual());
  const iniciais = (u?.nome || '?').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  return h('div', { class: 'whoami' },
    h('span', { class: 'avatar', 'aria-hidden': 'true' }, iniciais),
    h('span', { class: 't' }, h('b', {}, u?.nome || '—'), h('span', {}, u?.registro_profissional || u?.cargo || '')),
    h('select', {
      'aria-label': 'Papel em uso na demonstração',
      onchange: (e) => { definirPapel(e.target.value); location.reload(); },
    }, Object.entries(PAPEIS).map(([k, v]) => h('option', { value: k, selected: k === atual }, v))));
}

/**
 * Monta a casca e chama render(ctx, view).
 * ctx = { papeis, ator, nome, usuario, pode(recurso, acao), podeCompleto(recurso) } — a mesma forma
 * que as telas vão receber quando a origem dos dados for o banco, para nenhuma delas mudar na troca.
 */
export async function start(key, title, render) {
  const app = document.getElementById('app');
  const papeis = papeisAtuais(), ator = atorAtual();
  const ctx = {
    papeis, ator, nome: nomeDe(ator), usuario: usuarioPor(ator),
    pode: (recurso, acao = 'ver') => pode(papeis, recurso, acao),
    podeCompleto: (recurso) => podeCompleto(papeis, recurso),
  };

  // Os números do menu, pela MESMA função que as telas usam (js/filas.js). Antes havia um só,
  // contando tarefas pendentes do papel, ao lado de uma tela que somava solicitações em filas que
  // se sobrepõem: dois números diferentes sob o mesmo rótulo, e nenhum explicava o outro.
  const contagem = { 'filas/': 0, 'minhafila/': 0 };
  try {
    const { atual, minha } = contarFilas(papeis[0], ator, await dadosDasFilas());
    contagem['filas/'] = atual; contagem['minhafila/'] = minha;
  } catch { /* fila sem número é melhor que tela sem casca */ }

  const mod = NAV.find((n) => n[0] === key);
  const visiveis = NAV.filter((n) => !n[3] || ctx.pode(n[3]));
  const nav = h('nav', { class: 'nav', id: 'nav', 'aria-label': 'Seções do sistema' },
    visiveis.map(([p, rot, ic, , sep]) => [
      sep && h('span', { class: 'navsep', 'aria-hidden': 'true' }),
      h('a', { class: 'navi' + (p === key ? ' on' : ''), href: ROOT + p, 'aria-current': p === key ? 'page' : null },
        icon(ic), rot, contagem[p] ? h('span', { class: 'pill' }, String(contagem[p])) : null),
    ]));
  const burger = h('button', {
    class: 'burger', 'aria-label': 'Abrir navegação', 'aria-expanded': 'false', 'aria-controls': 'nav',
    onclick: (e) => { const o = nav.classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', String(o)); },
  }, icon('menu'));

  const view = h('main', { class: 'wrap', id: 'view' });
  app.replaceChildren(
    h('div', { class: 'topwrap' },
      h('header', { class: 'top' }, burger, assinatura(), nav, h('div', { class: 'tools' }, quemSouEu())),
      faixaDemo()),
    view);
  document.title = `${title} — ${MARCA.produto}`;

  if (mod && mod[3] && !ctx.pode(mod[3])) {
    view.replaceChildren(h('div', { class: 'empty' },
      h('h1', {}, 'Sem acesso'),
      h('p', { style: 'margin:8px 0 16px' }, `O papel "${PAPEIS[papeis[0]]}" não tem acesso a esta área. Em produção o servidor recusaria a consulta, não só a tela.`),
      h('a', { class: 'btn', href: ROOT }, 'Voltar à visão geral')));
    return;
  }
  view.append(h('div', { class: 'spin', 'aria-label': 'Carregando' }));
  try { view.replaceChildren(); await render(ctx, view); }
  catch (e) {
    console.error(e);
    view.replaceChildren(h('div', { class: 'empty' }, h('p', {}, 'Não foi possível carregar esta página. Recarregue; se continuar, avise o suporte.')));
  }
}

/** Cor da etapa pelo que ela significa: espera, pronto para seguir, ou encerrado. */
export const corEtapa = (etapa) => ({
  aberta: 'info', em_triagem: 'info', aguardando_prontuario: 'warn', prontuario_em_transito: 'warn',
  prontuario_na_recepcao: 'info', aguardando_medico: 'warn', aguardando_esclarecimento: 'warn',
  retorno_disponivel: 'ok', aguardando_contato_paciente: 'ok', aguardando_entrega: 'ok',
  concluida: 'dim', cancelada: 'dim',
}[etapa] ?? '');

/** "há 3 h", "há 2 d" — tempo na etapa, que é o indicador que a operação realmente olha. */
export function desde(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const horas = Math.floor(ms / 3600e3);
  if (horas < 1) return 'agora';
  if (horas < 24) return `há ${horas} h`;
  return `há ${Math.floor(horas / 24)} d`;
}
export const horasNa = (iso) => (Date.now() - new Date(iso).getTime()) / 3600e3;
