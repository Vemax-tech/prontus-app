// PRONTUS — casca da aplicação e peças visuais do sistema.
//
// Monta a barra superior, a navegação por papel, a faixa de demonstração e o quadro de conteúdo,
// e entrega às telas um contexto (ctx) com quem é o usuário e o que ele pode. As peças de interface
// genéricas vêm de ./base/ (sem conhecimento de domínio); o que é identidade do Prontus está aqui
// e no CSS de css/.
import { botaoOcupado, copyText, criarIcon, criarRun, empty as emptyBase, h, toast } from './base/dom.js';
import { papelAtual, papeisAtuais, atorAtual, PAPEIS } from './papel.js';
import { sair, perfilAtual } from './auth.js';
import { pode, podeCompleto, PAPEL_RESUMO } from './permissoes.js';
import { nomeDe, usuarioPor, registrarUsuarioDaSessao, reiniciar, avisosDoPapel, marcarAvisosLidos, escalonarAtrasos, prepararDados, atualizarAvisos, modo } from './dados.js';
import * as Navegador from './avisos-navegador.js';
import { dadosDasFilas, contarFilas } from './filas.js';
import { temaAtual, alternarTema, TEMAS } from './tema.js';
import { MARCA, MONOGRAMA } from './marca.js';
import { linkWhatsApp } from './mensagens.js';

export { instalarDom, h, fmtDate, linkSeguro, toast, copyText, modal, confirmDlg, formModal, tabs, qs, botaoOcupado } from './base/dom.js';
export { montar as montarMensagem, primeiroNome } from './mensagens.js';
export { dataTable, filtros, contem, baixarCsv } from './base/tabela.js';

const ROOT = new URL('../', import.meta.url).href;

// Ícones (Lucide). Conteúdo fixo, escrito aqui — nunca vindo de dado do usuário.
const ICONS = {
  marca: MONOGRAMA,
  sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  archive: '<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9M10 13h4"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  check: '<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  arrow: '<path d="M5 12h14M13 5l7 7-7 7"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  olho: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  lua: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  engrenagem: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5a1.6 1.6 0 0 1 1.6 1.6v.4a1.4 1.4 0 0 0 2.1 1.2l.3-.2a1.6 1.6 0 1 1 1.6 2.8l-.3.2a1.4 1.4 0 0 0 .5 2.4l.4.1a1.6 1.6 0 1 1 0 3.2l-.4.1a1.4 1.4 0 0 0-.5 2.4l.3.2a1.6 1.6 0 1 1-1.6 2.8l-.3-.2a1.4 1.4 0 0 0-2.1 1.2v.4a1.6 1.6 0 1 1-3.2 0v-.4a1.4 1.4 0 0 0-2.1-1.2l-.3.2a1.6 1.6 0 1 1-1.6-2.8l.3-.2a1.4 1.4 0 0 0-.5-2.4l-.4-.1a1.6 1.6 0 1 1 0-3.2l.4-.1a1.4 1.4 0 0 0 .5-2.4l-.3-.2a1.6 1.6 0 1 1 1.6-2.8l.3.2a1.4 1.4 0 0 0 2.1-1.2v-.4A1.6 1.6 0 0 1 12 2.5Z"/>',
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

/**
 * Linha de fila que ABRE NO LUGAR.
 *
 * O problema que ela resolve: a linha da fila diz o protocolo e o que falta, mas não diz de QUEM
 * é o caso nem o que o paciente pediu. Para descobrir isso era preciso trocar de tela, ler, e
 * voltar — e quem está esvaziando uma fila de dezesseis itens faz isso dezesseis vezes. Agora a
 * linha abre embaixo de si mesma, com o relato, o paciente, o prontuário e as ações.
 *
 * O conteúdo é montado só na primeira abertura: vinte linhas fechadas não pagam o preço de vinte
 * detalhes que ninguém pediu.
 *
 * `abertos` é um Set de ids mantido PELA TELA, não aqui: toda ação redesenha a lista, e sem isso
 * o que estava aberto se fecharia sozinho a cada clique — exatamente no momento em que a pessoa
 * está lendo aquilo.
 *
 * `montarLinha(gatilho)` recebe o botão de abrir, para a tela decidir onde ele entra na linha.
 */
export function linhaExpansivel({ id, abertos, montarLinha, montarCorpo, rotulo = 'Ver o caso sem sair da fila' }) {
  const painelId = 'peek-' + String(id).replace(/[^\w-]/g, '');
  const corpo = h('div', { class: 'peek', id: painelId });
  const wrap = h('div', { class: 'itemwrap' });
  let montado = false;

  const gatilho = h('button', {
    class: 'chev', type: 'button', 'aria-controls': painelId, 'aria-label': rotulo, title: rotulo,
    onclick: (e) => { e.stopPropagation(); alternar(); },
  }, icon('chevron'));

  function aplicar(aberto) {
    if (aberto && !montado) { montado = true; corpo.replaceChildren(montarCorpo()); }
    corpo.hidden = !aberto;
    wrap.classList.toggle('aberto', aberto);
    gatilho.setAttribute('aria-expanded', String(aberto));
  }
  function alternar() {
    const vai = corpo.hidden;
    if (vai) abertos.add(id); else abertos.delete(id);
    aplicar(vai);
  }

  const item = montarLinha(gatilho);
  item.classList.add('expansivel');
  // Clicar na parte vazia da linha também abre. O `closest` é o que impede isto de roubar o
  // clique do link do protocolo, do botão de assumir ou do próximo passo.
  item.addEventListener('click', (e) => { if (!e.target.closest('a, button, input, select, textarea, label')) alternar(); });

  wrap.append(item, corpo);
  aplicar(abertos.has(id));
  return wrap;
}

/** Par rótulo/valor do detalhe que abre na linha. Vazio não vira linha: '—' ocupa sem informar. */
export const peekCampo = (rotulo, valor) => (valor == null || valor === '' ? null
  : h('div', { class: 'pk' }, h('span', {}, rotulo), h('div', {}, valor)));

/** Barra de magnitude: uma série, cor constante, comprimento proporcional. */
export const barra = (n, max, tipo = '') => h('div', { class: 'bar' + (tipo ? ' ' + tipo : ''), role: 'presentation' },
  h('i', { style: `width:${max > 0 ? Math.max(2, Math.round((n / max) * 100)) : 0}%` }));

/** Linha "rótulo · barra · valor", para comparar quantidades numa lista. */
export const rowbar = (rotulo, n, max, { tipo = '', valor } = {}) => h('div', { class: 'rowbar' },
  h('span', {}, rotulo), barra(n, max, tipo), h('b', {}, valor ?? String(n)));

/**
 * A BARRA DO RECADO PRONTO — copiar, ou abrir o WhatsApp com o texto já escrito.
 *
 * Vai dentro do formulário que REGISTRA a comunicação, nunca solta numa tela. A ordem importa e é
 * a do processo real: o sistema escreve o recado, a pessoa confere e ajusta, abre o WhatsApp e
 * publica, volta e confirma — e é a confirmação que grava. Abrir o aplicativo não registra nada,
 * e a tela diz isso em letras para ninguém achar que registrou.
 *
 * O endereço é recalculado a cada tecla digitada no formulário: um link que ficasse com o texto
 * original levaria a mensagem errada justamente de quem teve o cuidado de corrigi-la.
 */
export function recadoPronto(form, lerTexto, { telefone = null, nota: aviso } = {}) {
  const abrir = h('a', {
    class: 'btn sm', target: '_blank', rel: 'noopener noreferrer',
    title: telefone ? 'Abre a conversa com o paciente, com o texto pronto' : 'Abre o WhatsApp com o texto pronto; o grupo você escolhe lá',
  }, 'Abrir no WhatsApp');
  const sincronizar = () => abrir.setAttribute('href', linkWhatsApp(lerTexto(), telefone));
  sincronizar();
  form.addEventListener('input', sincronizar);
  return h('div', { class: 'recado' },
    h('div', { class: 'row' },
      h('button', { class: 'btn sm', type: 'button', onclick: () => copyText(lerTexto()) }, icon('copy'), 'Copiar o texto'),
      abrir),
    h('p', { class: 'micro muted' }, aviso
      || 'O sistema não envia nada: ele escreve o texto e abre o aplicativo. Quem publica é você — e o que registra é este formulário, ao confirmar.'));
}

/** Observação em texto, com barra lateral. `tipo`: '' | 'warn' | 'info'. */
export const nota = (tipo, ...kids) => h('p', { class: 'note' + (tipo ? ' ' + tipo : '') }, kids);

/** Cabeçalho de página: olho, título, explicação e ações à direita. */
export const pageHead = (olho, titulo, sub, ...acoes) => h('div', { class: 'head' },
  h('div', {}, h('p', { class: 'eyebrow' }, olho), h('h1', {}, titulo), sub && h('p', { class: 'muted' }, sub)),
  h('div', { class: 'row' }, acoes));

// ---------------------------------------------------------------- navegação
// [pasta, rótulo, ícone, recurso exigido (null = todos), separador antes]
//
// A BARRA É FILTRADA PELA MATRIZ DE PERMISSÕES, e é de propósito que ela fique curta: cada papel
// vê só as telas do fluxo dele. O Arquivo não tem relatório nem administração; o Administrador não
// tem fila, porque acompanha em vez de executar. Ninguém precisa aprender a ignorar menu.
//
// A BARRA TEM CINCO GRUPOS, separados por um fio, na ordem em que a pessoa os usa:
//   começar (Visão geral) · trabalhar (as duas filas) · consultar (solicitações, prontuários,
//   registros) · relatar · administrar. O fio é de quem VEM DEPOIS; como o grupo some quando o papel
//   não o tem, o Administrador não vê um fio vazio no lugar da fila.
//
// Os nomes dizem o que a tela é, não a tela vizinha: "Fila da equipe" é o que ninguém assumiu,
// "Meus casos" é o que você assumiu. "Registros" reúne documentos emitidos e comunicações.
const NAV = [
  ['', 'Visão geral', 'home', 'dashboard', false],
  ['filas/', 'Fila da equipe', 'inbox', 'tarefa_ver', true],
  ['minhafila/', 'Meus casos', 'check', 'tarefa_ver', false],
  ['solicitacoes/', 'Solicitações', 'list', 'solicitacao_ver', true],
  ['prontuarios/', 'Prontuários', 'archive', 'prontuario_ver', false],
  ['registros/', 'Registros', 'file', 'comunicacao_ver', false],
  ['relatorios/', 'Relatórios', 'chart', 'relatorios', true],
  ['usuarios/', 'Usuários', 'users', 'usuarios', true],
  ['permissoes/', 'Permissões', 'shield', 'auditoria', false],
  // Configurações NÃO entra aqui: é de administração, usada de vez em quando, e mais um item
  // não cabe na barra nem em 1680 px — espremeria a navegação que a equipe usa o dia inteiro
  // para acomodar uma tela que se abre uma vez por mês. Fica como engrenagem, ao lado do perfil.
];

/** Assinatura da marca: serifa na palavra, monograma em petróleo. */
const assinatura = () => h('a', { class: 'mark', href: ROOT, 'aria-label': `${MARCA.produto} — início` },
  icon('marca'), h('span', {}, MARCA.produto), h('em', {}, MARCA.descritor));

/**
 * Faixa de demonstração: uma linha, sempre visível, não fechável. Só existe na camada em memória
 * (os testes de tela); com os dados no banco ela seria uma mentira, então não aparece.
 */
const faixaDemo = () => (modo() !== 'memoria' ? null : h('div', { class: 'demo', role: 'note' },
  icon('alert'),
  h('span', {}, h('b', {}, 'Demonstração'), ' — dados fictícios em memória. Nada é salvo e nenhum paciente real existe aqui.'),
  h('span', { class: 'sep', 'aria-hidden': 'true' }, '|'),
  // A segunda frase sai em tela estreita (app.css): a faixa precisa caber numa linha.
  h('span', { class: 'demo-2' }, 'Em produção as regras e as permissões vivem no banco, não no navegador.'),
  h('button', { class: 'linkbtn', onclick: async () => { await reiniciar(); location.reload(); } }, 'Reiniciar dados')));

/**
 * Quem está usando o sistema. NA DEMONSTRAÇÃO é um seletor, para mostrar as visões sem login.
 * EM PRODUÇÃO vira o nome de quem entrou, e o papel chega pela sessão autenticada (ver papel.js).
 */
/**
 * Troca de tema. É um botão só, não um menu: são dois temas, e o ícone mostra para onde o clique
 * leva. A troca é imediata e não recarrega a página — nenhum estado se perde no caminho.
 */
// Os botões de tema da página: o da barra e o da gaveta (celular). Trocar por um repinta os dois.
const botoesTema = new Map();
function botaoTema({ rotulo = false } = {}) {
  const pinta = (b) => {
    const claro = temaAtual() === 'claro';
    const vai = claro ? 'escuro' : 'claro';
    b.replaceChildren(icon(claro ? 'lua' : 'sol'), rotulo ? `Tema ${vai}` : null);
    b.setAttribute('aria-label', `Mudar para o tema ${vai}`);
    b.setAttribute('title', `Tema ${TEMAS[temaAtual()].toLowerCase()} — clique para o ${vai}`);
  };
  const b = h('button', {
    class: rotulo ? 'navi tema' : 'btn icon tema', type: 'button',
    onclick: () => {
      // Sem transição durante a troca: senão cada botão atravessa um quadro com a cor do tema
      // antigo e a barra pisca. Dois quadros depois, as transições voltam.
      const raiz = document.documentElement;
      raiz.classList.add('sem-transicao');
      alternarTema();
      botoesTema.forEach((p, x) => (x.isConnected ? p(x) : botoesTema.delete(x)));
      requestAnimationFrame(() => requestAnimationFrame(() => raiz.classList.remove('sem-transicao')));
    },
  });
  pinta(b);
  botoesTema.set(b, pinta);
  return b;
}

/**
 * Sininho de avisos. É o que o plano do projeto põe no lugar do grupo do WhatsApp: o aviso nasce
 * do próprio fluxo, tem destinatário (o papel) e tem não-lido — coisas que uma mensagem solta num
 * grupo nunca teve. Abre uma lista, cada linha leva ao caso, e abrir a lista marca como lido.
 */
/**
 * O INTERRUPTOR DO AVISO DO SISTEMA — a notificação que aparece por cima de tudo.
 *
 * Mora DENTRO do sininho de propósito. É ali que a pessoa está pensando em avisos, e é o único
 * lugar em que pedir permissão ao navegador faz sentido: um pedido que salta sozinho ao abrir a
 * página é negado por reflexo, e uma negativa dessas não se desfaz — o navegador não deixa
 * perguntar de novo.
 */
function interruptorDeNotificacao() {
  const linha = h('div', { class: 'af' });
  const pintar = () => {
    const e = Navegador.estado();
    const texto = {
      indisponivel: 'Este navegador não avisa fora da aba. O número no título da aba continua valendo.',
      negado: 'Você bloqueou os avisos deste site no navegador. Para voltar atrás, é no cadeado da barra de endereço.',
      desligado: 'Quer ser avisado mesmo com a aba em segundo plano?',
      ligado: 'Avisando nesta máquina, mesmo com a aba em segundo plano.',
    }[e];
    linha.replaceChildren(
      h('p', { class: 'micro muted' }, texto),
      e === 'desligado'
        ? h('button', { class: 'btn sm', type: 'button', onclick: async () => { await Navegador.ligar(); pintar(); } }, 'Avisar nesta máquina')
        : e === 'ligado'
          ? h('button', { class: 'linkbtn', type: 'button', onclick: () => { Navegador.desligar(); pintar(); } }, 'Desligar')
          : null);
  };
  pintar();
  return linha;
}

function sinoDeAvisos(ctx) {
  const papel = ctx.papeis[0];
  const lista = h('div', { class: 'avisos', hidden: '' });
  const pino = h('span', { class: 'pill' });
  const botao = h('button', {
    class: 'btn icon', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false',
    onclick: (e) => abrir(e.currentTarget),
  }, icon('alert'), pino);

  function contar() {
    const n = avisosDoPapel(papel, { somenteNaoLidos: true }).length;
    pino.textContent = n > 9 ? '9+' : String(n);
    pino.hidden = !n;
    botao.setAttribute('aria-label', n ? `${n} aviso(s) não lido(s)` : 'Avisos — nenhum não lido');
    return n;
  }

  async function abrir(b) {
    const mostrando = !lista.hidden;
    if (mostrando) { lista.hidden = true; b.setAttribute('aria-expanded', 'false'); return; }
    const todos = avisosDoPapel(papel).slice(0, 12);
    lista.replaceChildren(
      h('div', { class: 'ah' }, h('b', {}, 'Avisos para ' + PAPEIS[papel]),
        h('span', { class: 'micro muted' }, todos.length ? `${todos.length} recentes` : 'nenhum')),
      todos.length
        ? h('ul', { class: 'ul-list' }, todos.map((a) => h('li', { class: a.lido_em ? 'lido' : '' },
          h('a', { href: ROOT + `solicitacoes/detalhe.html?id=${a.solicitacao_id}` },
            h('b', {}, '#' + a.protocolo), ' ', a.texto,
            h('div', { class: 'micro muted' }, desde(a.criado_em))))))
        : h('p', { class: 'small muted', style: 'padding:10px 12px' },
          'Nada aqui. Os avisos aparecem sozinhos quando um caso entra na fila do seu papel.'),
      interruptorDeNotificacao());
    lista.hidden = false;
    b.setAttribute('aria-expanded', 'true');
    // Abrir é ler: o sininho existe para zerar, não para acumular culpa.
    await marcarAvisosLidos({ papel, ator: ctx.ator });
    contar();
  }

  contar();
  // `atualizar` é o que o relógio da casca chama: o número do sininho muda sozinho, sem a pessoa
  // precisar recarregar nem abrir a lista.
  return { el: h('div', { class: 'sino' }, botao, lista), atualizar: contar };
}

function quemSouEu() {
  const atual = papelAtual();
  const u = usuarioPor(atorAtual());
  const iniciais = (u?.nome || '?').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  return h('div', { class: 'whoami' },
    h('span', { class: 'avatar', 'aria-hidden': 'true' }, iniciais),
    h('span', { class: 't' }, h('b', {}, u?.nome || '—'), h('span', {}, u?.cargo || PAPEIS[atual])),
    botaoOcupado([icon('sair'), h('span', { class: 'sair-rotulo' }, 'Sair')], () => sair('saiu'), {
      class: 'btn sm sair', 'aria-label': `Sair do sistema (${u?.nome || PAPEIS[atual]})`, title: 'Sair do sistema',
    }));
}

/**
 * Monta a casca e chama render(ctx, view).
 * ctx = { papeis, ator, nome, usuario, pode(recurso, acao), podeCompleto(recurso) } — a mesma forma
 * que as telas vão receber quando a origem dos dados for o banco, para nenhuma delas mudar na troca.
 */
export async function start(key, title, render) {
  const app = document.getElementById('app');
  const papeis = papeisAtuais(), ator = atorAtual();
  // Sem papel não há tela: a guarda de boot.js já manda para o login, isto cobre quem chegar aqui por outro caminho.
  if (!papeis.length) { await sair(); return; }
  registrarUsuarioDaSessao(perfilAtual());
  // Pacientes, prontuários, equipe, configuração e avisos: o que as telas leem de forma síncrona.
  await prepararDados();
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
    // Antes de contar, o prazo cobra: o que estourou a meta vira aviso de verdade (js/dados.js).
    await escalonarAtrasos();
    await atualizarAvisos();
    const { atual, minha } = contarFilas(papeis[0], ator, await dadosDasFilas());
    contagem['filas/'] = atual; contagem['minhafila/'] = minha;
  } catch { /* fila sem número é melhor que tela sem casca */ }

  // As pílulas do menu ficam guardadas para o relógio da casca poder atualizá-las sem redesenhar
  // a navegação: trocar a barra de lugar enquanto alguém está clicando nela é como um sistema
  // rouba o próprio clique.
  const pilulas = {};
  const pilulaDoMenu = (p) => {
    if (!(p in contagem)) return null;
    const el = h('span', { class: 'pill', hidden: contagem[p] ? null : '' }, String(contagem[p] || ''));
    pilulas[p] = el;
    return el;
  };

  const mod = NAV.find((n) => n[0] === key);
  const visiveis = NAV.filter((n) => !n[3] || ctx.pode(n[3]));
  const nav = h('nav', { class: 'nav', id: 'nav', 'aria-label': 'Seções do sistema' },
    visiveis.map(([p, rot, ic, , sep]) => [
      sep && h('span', { class: 'navsep', 'aria-hidden': 'true' }),
      h('a', { class: 'navi' + (p === key ? ' on' : ''), href: ROOT + p, 'aria-current': p === key ? 'page' : null },
        icon(ic), rot, pilulaDoMenu(p)),
    ]),
    // Só aparece na gaveta do celular (app.css): na barra estreita, o tema cede o lugar à marca.
    // O mesmo vale para Configurações, que na barra larga é a engrenagem ao lado do perfil.
    h('div', { class: 'navextra' }, h('span', { class: 'navsep', 'aria-hidden': 'true' }),
      ctx.pode('configuracoes')
        ? h('a', { class: 'navi' + (key === 'configuracoes/' ? ' on' : ''), href: ROOT + 'configuracoes/', 'aria-current': key === 'configuracoes/' ? 'page' : null }, icon('engrenagem'), 'Configurações')
        : null,
      botaoTema({ rotulo: true })));
  // Gaveta de navegação em tela estreita: abre pelo botão, fecha pelo botão, pelo véu e pelo Esc.
  const scrim = h('div', { class: 'navscrim', 'aria-hidden': 'true', onclick: () => gaveta(false) });
  const burger = h('button', {
    class: 'burger', type: 'button', 'aria-label': 'Abrir navegação', 'aria-expanded': 'false', 'aria-controls': 'nav',
    onclick: () => gaveta(!nav.classList.contains('open')),
  }, icon('menu'));
  function gaveta(abrir) {
    nav.classList.toggle('open', abrir); scrim.classList.toggle('open', abrir);
    burger.setAttribute('aria-expanded', String(abrir));
    burger.setAttribute('aria-label', abrir ? 'Fechar navegação' : 'Abrir navegação');
    if (abrir) nav.querySelector('.navi')?.focus();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('open') && !document.querySelector('.ov')) { gaveta(false); burger.focus(); }
  });

  const view = h('main', { class: 'wrap', id: 'view', tabindex: '-1' });
  const sino = sinoDeAvisos(ctx);
  app.replaceChildren(
    // Move o foco sem trocar o hash: o detalhe do caso usa `#acao=` para abrir o formulário certo,
    // e `#view` no lugar dele perderia isso num recarregamento.
    h('a', { class: 'skip', href: '#view', onclick: (e) => { e.preventDefault(); view.focus(); } }, 'Pular para o conteúdo'),
    h('div', { class: 'topwrap' },
      h('header', { class: 'top' }, burger, assinatura(), nav, h('div', { class: 'tools' },
        sino.el,
        ctx.pode('configuracoes')
          ? h('a', { class: 'btn icon cfg' + (key === 'configuracoes/' ? ' on' : ''), href: ROOT + 'configuracoes/', 'aria-label': 'Configurações da clínica', title: 'Configurações da clínica' }, icon('engrenagem'))
          : null,
        botaoTema(), quemSouEu())),
      faixaDemo()),
    scrim,
    view);
  Navegador.definirTitulo(`${title} — ${MARCA.produto}`);
  vigiarTrabalho(ctx, { pilulas, sino });

  if (mod && mod[3] && !ctx.pode(mod[3])) {
    view.replaceChildren(h('div', { class: 'empty' },
      h('h1', {}, 'Sem acesso'),
      h('p', { style: 'margin:8px 0 16px' }, `Esta área não faz parte do fluxo de ${PAPEIS[papeis[0]]}. ${PAPEL_RESUMO[papeis[0]] || ''} Em produção o servidor recusaria a consulta, não só a tela.`),
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

// ---------------------------------------------------------------- o relógio da casca
//
// A tela de fila já vigiava a própria lista (js/atualiza.js). Isto aqui vigia o TRABALHO, de
// qualquer tela do sistema: enquanto alguém estiver com o Prontus aberto — na visão geral, num
// caso, no relatório —, o número do menu, o número do sininho, o título da aba e o ícone dela
// continuam dizendo a verdade, e um caso que chega agora aparece sem ninguém apertar nada.
//
// É o que separa "o sistema responde quando eu entro nele" de "o sistema me chama". Sem isso, o
// grupo do WhatsApp continua sendo o despertador da clínica.
//
// NÃO REDESENHA NADA: só troca números em nós que já existem. Redesenhar a barra enquanto alguém
// clica nela é a forma mais fácil de um sistema roubar o próprio clique.
const INTERVALO_CASCA = 12000;
const CHAVE_ANUNCIADOS = 'prontus.avisos.anunciados';

const anunciados = () => {
  try { return new Set(JSON.parse(sessionStorage.getItem(CHAVE_ANUNCIADOS) || '[]')); } catch { return new Set(); }
};
const guardarAnunciados = (s) => {
  try { sessionStorage.setItem(CHAVE_ANUNCIADOS, JSON.stringify([...s].slice(-200))); } catch { /* sem storage: avisa de novo, e paciência */ }
};

async function vigiarTrabalho(ctx, { pilulas, sino }) {
  const papel = ctx.papeis[0];

  const ciclo = async () => {
    await escalonarAtrasos();
    await atualizarAvisos();
    let n = { atual: 0, minha: 0 };
    try { n = contarFilas(papel, ctx.ator, await dadosDasFilas()); } catch { return; }

    const porMenu = { 'filas/': n.atual, 'minhafila/': n.minha };
    for (const [p, el] of Object.entries(pilulas)) {
      el.textContent = String(porMenu[p] || '');
      el.hidden = !porMenu[p];
    }
    const naoLidos = avisosDoPapel(papel, { somenteNaoLidos: true });
    sino.atualizar();
    Navegador.marcar(naoLidos.length);

    // Só o que ainda não foi anunciado NESTA SESSÃO. A lista vive no sessionStorage, então
    // navegar entre telas (que aqui é sempre uma recarga inteira) não vira um segundo aviso do
    // mesmo caso — e fechar a aba zera, porque voltar amanhã merece ser avisado de novo.
    const vistos = anunciados();
    const novos = naoLidos.filter((a) => !vistos.has(a.id));
    if (!novos.length) return;
    novos.forEach((a) => vistos.add(a.id));
    guardarAnunciados(vistos);
    const um = novos.length === 1 ? novos[0] : null;
    Navegador.notificar({
      titulo: um ? `${MARCA.produto} — caso #${um.protocolo}` : `${MARCA.produto} — ${novos.length} casos para ${PAPEIS[papel]}`,
      // NUNCA o nome do paciente nem o relato: a notificação aparece na tela de bloqueio e na
      // frente de quem passar pelo balcão. O caso inteiro está a um clique.
      corpo: um ? um.texto : 'Entraram na sua fila. Abra para ver quais.',
      url: ROOT + (um ? `solicitacoes/detalhe.html?id=${um.solicitacao_id}` : 'filas/'),
      tag: 'fila-' + papel,
    });
  };

  await ciclo();
  // O relógio é da JANELA, não do processo: assim ele morre junto com a página que o criou —
  // inclusive no jsdom dos testes, onde não existe "fechar a aba" para disparar o pagehide.
  const t = window.setInterval(() => { if (!document.hidden) ciclo(); }, INTERVALO_CASCA);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ciclo(); });
  window.addEventListener('pagehide', () => window.clearInterval(t), { once: true });
}

/** Cor da etapa pelo que ela significa: espera, pronto para seguir, ou encerrado. */
export const corEtapa = (etapa) => ({
  aberta: 'info', em_triagem: 'info', aguardando_prontuario: 'warn', prontuario_em_transito: 'warn',
  prontuario_na_recepcao: 'info', com_medico: 'warn', aguardando_esclarecimento: 'warn',
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
