// PRONTUS — a tela inicial. Todos os números saem dos dados; nenhum é decorativo, e cada
// indicador mostra embaixo o critério de contagem. Indicador sem critério é opinião.
//
// SÃO DUAS TELAS SOB O MESMO ENDEREÇO, porque são dois trabalhos diferentes:
//
//  · QUEM OPERA (Call Center, Arquivo, Recepção) abre o sistema para saber o que fazer agora.
//    Recebe "A sua vez": as filas do próprio papel, com número e atalho, os casos que já são seus
//    e o que passou da meta na sua etapa. Nada de volume, média ou pendência de outra equipe —
//    número que não leva a uma ação é ruído na tela de quem tem fila para esvaziar.
//
//  · QUEM ADMINISTRA abre o sistema para saber como a clínica está. Recebe o painel inteiro:
//    todos os indicadores, onde o trabalho empoça, pendência por equipe, volume, tempos, quem tem
//    acesso e as últimas ações registradas. É o "acompanhar tudo" — e é por isso que ele não tem
//    fila: quem cobra não disputa trabalho com quem é cobrado.
import * as F from '../fluxo.js';
import { listar, configAtual, pacientePor, nomeDe } from '../dados.js';
import { situacao, atrasadas, explicar } from '../prazos.js';
import { dadosDasFilas, filasDoPapel, repartir, proximoCaso } from '../filas.js';
import {
  start, h, run, pageHead, badge, stat, stats, rowbar, nota, icon, desde, corEtapa, horasNa,
  linhaExpansivel, peekCampo, fmtDate,
} from '../ui.js';
import { PAPEIS, PAPEL_RESUMO } from '../permissoes.js';

const ROOT = new URL('../../', import.meta.url).href;
const media = (ns) => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null);
const horas = (n) => (n == null ? '—' : n < 24 ? `${Math.round(n)} h` : `${(n / 24).toFixed(1)} d`);
const painel = (titulo, extra, ...corpo) => h('section', { class: 'panel' },
  h('div', { class: 'ph' }, h('h2', {}, titulo), extra),
  h('div', { class: 'pb' }, corpo));
const lista = (filtro) => ROOT + 'solicitacoes/' + (filtro ? '?' + filtro : '');

/**
 * Linha de caso, igual nas duas versões da tela, e que ABRE NO LUGAR: a lista responde "o que
 * falta", e a abertura responde "de quem é e o que pediram" sem trocar de tela.
 *
 * `abertos` vem de fora porque esta tela se redesenha, e o que a pessoa acabou de abrir não pode
 * fechar sozinho por causa de um clique em outro lugar.
 */
const itemCaso = (s, metas, ctx, abertos, pronts = []) => linhaExpansivel({
  id: s.id,
  abertos,
  rotulo: `Ver o caso #${s.protocolo} sem sair desta tela`,
  montarLinha: (gatilho) => {
    const sit = situacao(s, metas);
    return h('div', { class: 'item' + (sit.estado === 'atrasada' ? ' late' : '') },
      h('div', {},
        h('a', { class: 'id', href: ROOT + `solicitacoes/detalhe.html?id=${s.id}` }, '#' + s.protocolo),
        h('div', { class: 'sub' }, F.TIPO_CURTO[s.tipo])),
      h('div', { class: 'o' }, F.proximaAcao(s).texto,
        sit.estado !== 'sem_meta' ? h('div', { class: 'micro muted' }, explicar(s, metas)) : null),
      h('div', { class: 'st' },
        sit.rotulo ? badge(sit.rotulo, sit.estado === 'atrasada' ? 'crit' : 'warn') : null,
        s.prioridade === 'alta' ? badge('Alta', 'crit') : null,
        badge(F.ETAPAS[s.etapa], corEtapa(s.etapa)),
        h('span', { class: 'age' + (sit.estado === 'atrasada' ? ' tarde' : '') }, desde(s.etapa_desde)),
        gatilho));
  },
  montarCorpo: () => {
    const pac = pacientePor(s.paciente_id);
    const pront = pronts.find((p) => p.id === s.prontuario_id);
    const verPac = ctx.podeCompleto('paciente_identificacao') || ctx.pode('paciente_identificacao');
    const prox = F.proximaAcao(s);
    return h('div', {},
      h('div', { class: 'pks' },
        peekCampo('Paciente', verPac && pac
          ? h('span', {}, pac.nome, h('div', { class: 'micro muted' }, `nasc. ${fmtDate(pac.nascimento)} · ${pac.telefone}`))
          : h('span', { class: 'muted' }, 'reduzido para o seu papel')),
        peekCampo('Prontuário', pront
          ? h('span', { class: 'mono' }, pront.codigo, h('div', { class: 'micro muted' }, F.LOCAIS[pront.local]))
          : null),
        peekCampo('Próxima ação', h('span', {}, prox.texto,
          h('div', { class: 'micro muted' }, prox.papel ? 'responsável: ' + prox.papel : 'caso encerrado'))),
        peekCampo('Com quem está', s.assumido_por
          ? h('span', {}, nomeDe(s.assumido_por), s.assumido_por === ctx.ator ? h('div', { class: 'micro', style: 'color:var(--ok)' }, 'é você') : null)
          : h('span', { class: 'muted' }, 'ninguém ainda')),
        s.medico_nome ? peekCampo('Médico', h('span', {}, s.medico_nome, h('div', { class: 'micro muted' }, 'fora do sistema'))) : null),
      s.relato ? h('p', { class: 'relato' }, s.relato) : null,
      h('div', { class: 'acts' },
        h('a', { class: 'btn sm', href: ROOT + `solicitacoes/detalhe.html?id=${s.id}` }, icon('arrow'), 'Abrir o caso'),
        F.aberta(s) ? h('a', { class: 'btn sm', href: ROOT + 'filas/' }, 'Ver na fila') : null));
  },
});

/** "Onde o trabalho está parado" — uma série, o comprimento é a quantidade. Serve aos dois. */
function ondeEstaParado(abertas) {
  const porEtapa = Object.entries(F.ETAPAS)
    .map(([e, rot]) => ({ e, rot, n: abertas.filter((s) => s.etapa === e).length }))
    .filter((x) => x.n);
  const max = Math.max(1, ...porEtapa.map((x) => x.n));
  return painel('Onde o trabalho está parado', h('span', { class: 'micro muted' }, `${abertas.length} em aberto`),
    porEtapa.length
      ? h('div', { style: 'display:grid;gap:9px' }, porEtapa.map((x) => rowbar(x.rot, x.n, max)))
      : h('p', { class: 'small muted' }, 'Nada em aberto.'));
}

// ================================================================ quem opera
/**
 * A tela de quem tem fila. O conteúdo vem de js/filas.js — as MESMAS filas da tela "Fila atual" e
 * do número no menu —, então o que esta tela promete é exatamente o que a próxima entrega. Enquanto
 * cada tela contava do seu jeito, a inicial dizia um número e a fila mostrava outro.
 */
async function telaDeEquipe(ctx, view, { abertas, metas, pronts }) {
  const papel = ctx.papeis[0];
  const abertos = new Set();
  const linha = (s) => itemCaso(s, metas, ctx, abertos, pronts);
  const D = await dadosDasFilas();
  const partes = filasDoPapel(papel, D).map((f) => repartir(f, ctx.ator, papel));

  function botaoProximoCaso() {
    const alvo = proximoCaso(papel, ctx.ator, D, metas);
    if (!alvo) return null;
    const sit = situacao(alvo, metas);
    return h('a', {
      class: 'btn primary',
      href: ROOT + `solicitacoes/detalhe.html?id=${alvo.id}`,
      title: `#${alvo.protocolo} — ${F.proximaAcao(alvo).texto}`,
    }, icon('arrow'), `Próximo caso · #${alvo.protocolo}`,
    sit.estado === 'atrasada' ? badge('atrasado', 'crit') : null);
  }

  const quanto = (f) => f.livres.length + f.custodia.length;
  const meus = [...new Map(partes.flatMap((f) => f.meus).map((s) => [s.id, s])).values()];
  const livres = new Set(partes.flatMap((f) => [...f.livres, ...f.custodia]).map((x) => x.id)).size;

  // Os indicadores SÃO as filas do papel: cada um leva ao trabalho que ele conta, e o critério
  // embaixo é a própria definição da fila. Nenhum número aqui é informativo-e-pronto.
  const indicadores = partes.slice(0, 5).map((f) => stat({
    k: f.titulo,
    v: quanto(f),
    c: f.dica.toLowerCase(),
    tipo: quanto(f) ? 'warn' : '',
    href: ROOT + 'filas/',
  }));

  // Atrasos DA SUA ETAPA: cobrar de uma equipe o tempo que o caso passou com outra é o jeito mais
  // rápido de o alerta deixar de ser levado a sério.
  const minhas = abertas.filter((s) => F.papeisDaEtapa(s).includes(papel));
  const atrasos = atrasadas(minhas, metas);

  const suaVez = painel(
    atrasos.length ? 'Passou da meta na sua etapa' : 'Esperando a sua equipe',
    h('a', { class: 'btn sm', href: ROOT + 'filas/' }, 'Abrir a fila'),
    atrasos.length
      ? nota('crit', `${atrasos.length} ${atrasos.length === 1 ? 'caso passou' : 'casos passaram'} da meta enquanto estava com ${PAPEIS[papel]}. A ordem é pelo quanto cada um excedeu.`)
      : nota('', minhas.length
        ? `${minhas.length} ${minhas.length === 1 ? 'caso está' : 'casos estão'} na vez da sua equipe e todos dentro da meta.`
        : 'Nada esperando a sua equipe agora.'),
    (atrasos.length ? atrasos.map((x) => x.sol) : minhas)
      .slice(0, 8).map(linha));

  const minhaFila = painel('Os casos que você assumiu',
    h('a', { class: 'btn sm', href: ROOT + 'minhafila/' }, 'Minha fila'),
    meus.length
      ? h('div', {}, meus.slice(0, 6).map(linha))
      : h('p', { class: 'small muted' }, livres
        ? `Você não assumiu nenhum caso. Há ${livres} esperando alguém pegar na Fila atual.`
        : 'Você não assumiu nenhum caso, e não há nada solto na fila da equipe.'));

  // AS DUAS LISTAS DE CASO FICAM NA COLUNA LARGA, e o gráfico de barras na estreita.
  // A linha de caso é uma grade de três colunas (quem, o que falta, estado): na lateral de 340 px
  // ela espremia até quebrar uma palavra por linha e as etiquetas vazavam o painel. Barra com
  // rótulo, ao contrário, lê bem em qualquer largura — então quem vai para a lateral é ela.
  view.append(
    // "Próximo caso" na tela em que a pessoa ENTRA: para quem atende em série, abrir o sistema e
    // já estar no caso certo é o caminho mais curto possível entre chegar e trabalhar. Qual é o
    // "certo" está em js/filas.js — atraso primeiro, depois prioridade, depois o mais parado.
    pageHead(PAPEIS[papel], `Olá, ${ctx.nome.split(' ')[0]}`, PAPEL_RESUMO[papel], botaoProximoCaso()),
    indicadores.length ? stats(indicadores) : null,
    h('div', { class: 'det' },
      h('div', { class: 'main' }, suaVez, minhaFila),
      h('div', { class: 'aside' }, ondeEstaParado(abertas))),
    h('p', { class: 'micro muted', style: 'margin-top:22px' }, icon('olho'),
      ' Clique numa linha para ver de quem é o caso e o que o paciente pediu, sem trocar de tela.'),
    h('p', { class: 'micro muted', style: 'margin-top:8px' }, icon('check'),
      ' Os números acima são as suas filas, contadas pela mesma regra da tela "Fila atual" — o que'
      + ' aparece aqui é exatamente o que você encontra lá.'));
}

// ================================================================ quem administra
async function telaDeAdmin(ctx, view, { sols, abertas, metas, tarefas, pronts, docs, entregas }) {
  const [usuarios, auditoria] = await Promise.all([run(listar('usuarios')), run(listar('auditoria'))]);
  const abertos = new Set();
  const linha = (s) => itemCaso(s, metas, ctx, abertos, pronts);
  const emEtapa = (...e) => abertas.filter((s) => e.includes(s.etapa));
  const prontPendentes = pronts.filter((p) => p.local !== 'arquivo');
  const receitasProntas = emEtapa('retorno_disponivel').filter((s) => docs.some((d) => d.solicitacao_id === s.id && d.estado === 'emitido'));
  const atrasos = atrasadas(abertas, metas);

  const indicadores = [
    stat({ k: 'Abertas', v: abertas.length, c: 'etapa não é concluída nem cancelada', href: lista('') }),
    stat({ k: 'Paradas além da meta', v: atrasos.length, c: 'passaram do prazo definido em Configurações', tipo: atrasos.length ? 'crit' : 'ok', href: lista('prazo=atrasada') }),
    stat({ k: 'Aguardando prontuário', v: emEtapa('aguardando_prontuario', 'prontuario_em_transito').length, c: 'aguardando ou em trânsito', tipo: 'warn', href: lista('etapa=aguardando_prontuario') }),
    stat({ k: 'Aguardando Recepção', v: emEtapa('prontuario_na_recepcao', 'retorno_disponivel').length, c: 'conferir ou avisar o retorno', href: lista('etapa=prontuario_na_recepcao') }),
    stat({ k: 'Com o médico', v: emEtapa('com_medico', 'aguardando_esclarecimento').length, c: 'fora do sistema, inclui esclarecimentos', tipo: 'warn', href: lista('etapa=com_medico') }),
    stat({ k: 'Receitas a comunicar', v: receitasProntas.length, c: 'retorno registrado com documento emitido', tipo: receitasProntas.length ? 'ok' : '', href: lista('etapa=retorno_disponivel') }),
    stat({ k: 'Aguardando contato', v: emEtapa('aguardando_contato_paciente').length, c: 'paciente ainda não foi informado', href: lista('etapa=aguardando_contato_paciente') }),
    stat({ k: 'Prontuários a devolver', v: prontPendentes.length, c: 'independe da etapa da solicitação', tipo: prontPendentes.length ? 'warn' : '', href: ROOT + 'prontuarios/' }),
  ];

  // Ordenado pelo EXCEDENTE, não pelo tempo total: o que passou mais da própria meta é o que
  // precisa de atenção primeiro. Uma entrega parada há 20 h com meta de 24 h não é problema;
  // um caso com o médico há 5 h, com meta de 2 h, é.
  const naLista = atrasos.length
    ? atrasos.slice(0, 8).map((x) => x.sol)
    : [...abertas].sort((a, b) => horasNa(b.etapa_desde) - horasNa(a.etapa_desde)).slice(0, 8);
  const semMeta = abertas.filter((s) => situacao(s, metas).estado === 'sem_meta').length;
  const paradas = painel(atrasos.length ? 'Pedidos parados além da meta' : 'Mais tempo parado na etapa',
    h('a', { class: 'btn sm', href: lista(atrasos.length ? 'prazo=atrasada' : '') }, 'Ver todas'),
    atrasos.length
      ? nota('crit', `${atrasos.length} ${atrasos.length === 1 ? 'pedido passou' : 'pedidos passaram'} da meta da própria etapa. A ordem aqui é pelo quanto cada um excedeu, não pelo tempo total.`)
      : nota('', semMeta
        ? `Nada atrasado agora. ${semMeta} ${semMeta === 1 ? 'caso está' : 'casos estão'} em etapa sem meta definida — defina em Configurações para o alerta valer ali também.`
        : 'Nada atrasado agora: todas as etapas abertas estão dentro da meta definida pela clínica.'),
    naLista.length
      ? h('div', { style: 'margin-top:10px' }, naLista.map(linha))
      : h('p', { class: 'small muted', style: 'margin-top:10px' }, 'Nada em aberto.'));

  // ---------- pendências por equipe
  const pend = tarefas.filter((t) => t.estado === 'pendente');
  const equipes = painel('Pendências por equipe', h('span', { class: 'micro muted' }, `${pend.length} tarefas`),
    h('ul', { class: 'ul-list' }, ['callcenter', 'arquivo', 'recepcao'].map((p) => {
      const n = pend.filter((t) => t.papel_responsavel === p).length;
      return h('li', { class: 'row between' },
        h('span', {}, PAPEIS[p]),
        n ? badge(`${n} pendente${n > 1 ? 's' : ''}`, n > 3 ? 'warn' : '') : badge('em dia', 'ok'));
    })));

  // ---------- volume por tipo
  const porTipo = Object.keys(F.TIPOS).map((t) => ({ t, n: sols.filter((s) => s.tipo === t).length, ab: abertas.filter((s) => s.tipo === t).length }));
  const maxTipo = Math.max(1, ...porTipo.map((x) => x.n));
  const volume = painel('Volume por tipo', h('span', { class: 'micro muted' }, `${sols.length} no total`),
    h('div', { style: 'display:grid;gap:12px' }, porTipo.map(({ t, n, ab }) => h('div', {},
      rowbar(F.TIPOS[t], n, maxTipo),
      h('p', { class: 'micro muted', style: 'margin-top:3px' }, `${ab} em aberto`)))));

  // ---------- tempos
  const concl = sols.filter((s) => s.concluida_em);
  const tConclusao = media(concl.map((s) => (new Date(s.concluida_em) - new Date(s.criado_em)) / 3600e3));
  const tEspera = media(abertas.map((s) => horasNa(s.etapa_desde)));
  const semConfirmacao = entregas.filter((e) => !F.ENTREGA_TERMINAL.includes(e.estado) && e.estado !== 'nao_aplicavel').length;
  const tempos = painel('Tempos', h('a', { class: 'btn sm', href: ROOT + 'relatorios/' }, 'Relatórios'),
    h('dl', { class: 'dl' },
      h('dt', {}, 'Média até concluir'), h('dd', { class: 'num' }, horas(tConclusao), h('div', { class: 'micro muted' }, `${concl.length} solicitações concluídas`)),
      h('dt', {}, 'Média na etapa atual'), h('dd', { class: 'num' }, horas(tEspera), h('div', { class: 'micro muted' }, `${abertas.length} em aberto`)),
      h('dt', {}, 'Entregas sem confirmação'), h('dd', { class: 'num' }, String(semConfirmacao),
        h('div', { class: 'micro muted' }, 'envio tentado não conta: tentativa não é entrega'))));

  // ---------- quem tem acesso (só o Administrador vê, e é ele quem mexe)
  const ativos = usuarios.filter((u) => u.ativo !== false);
  const equipe = painel('Quem tem acesso', h('a', { class: 'btn sm', href: ROOT + 'usuarios/' }, 'Gerenciar'),
    h('ul', { class: 'ul-list' }, ['callcenter', 'arquivo', 'recepcao', 'admin'].map((p) => {
      const n = ativos.filter((u) => u.papeis.includes(p)).length;
      return h('li', { class: 'row between' }, h('span', {}, PAPEIS[p]), badge(`${n} ativo${n === 1 ? '' : 's'}`, n ? '' : 'crit'));
    })),
    usuarios.length > ativos.length
      ? h('p', { class: 'micro muted', style: 'margin-top:8px' }, `${usuarios.length - ativos.length} conta(s) desativada(s) — continuam no histórico, sem acesso.`)
      : null);

  // ---------- últimas ações: o "acompanhar tudo" com nome e horário
  const ultimas = painel('Últimas ações registradas', h('a', { class: 'btn sm', href: ROOT + 'permissoes/' }, 'Auditoria'),
    auditoria.length
      ? h('ul', { class: 'ul-list' }, [...auditoria].reverse().slice(0, 8).map((a) => h('li', {},
        h('div', { class: 'row between' },
          h('span', { class: 'small' }, a.acao, ' · ', a.recurso),
          h('span', { class: 'when' }, new Date(a.quando).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))),
        h('p', { class: 'micro muted' }, a.detalhe || '—'))))
      : h('p', { class: 'small muted' }, 'Nada registrado nesta sessão ainda.'));

  view.append(
    pageHead('Administração', 'Visão geral',
      `Olá, ${ctx.nome.split(' ')[0]}. A clínica inteira numa tela — todos os números vêm dos registros, nenhum é ilustrativo.`),
    stats(indicadores),
    h('div', { class: 'det' },
      h('div', { class: 'main' }, paradas, volume),
      h('div', { class: 'aside' }, ondeEstaParado(abertas), equipes, tempos, equipe, ultimas)),
    h('p', { class: 'micro muted', style: 'margin-top:22px' }, icon('clock'),
      ' O critério de contagem de cada indicador está escrito embaixo do próprio número.'
      + ' Clique numa linha da lista para ver o caso sem trocar de tela.'));
}

// ================================================================ despacho
export const init = () => start('', 'Visão geral', async (ctx, view) => {
  const [sols, tarefas, pronts, docs, entregas] = await Promise.all([
    run(listar('solicitacoes')), run(listar('tarefas')), run(listar('prontuarios')),
    run(listar('documentos')), run(listar('entregas')),
  ]);
  const dados = { sols, tarefas, pronts, docs, entregas, abertas: sols.filter(F.aberta), metas: configAtual().metas };
  // Quem administra vê o painel inteiro; quem opera vê a própria vez. O critério é a permissão,
  // não o nome do papel: um papel novo com dashboard completo cai no painel sem mexer aqui.
  return ctx.podeCompleto('dashboard') && !ctx.pode('tarefa_ver')
    ? telaDeAdmin(ctx, view, dados)
    : telaDeEquipe(ctx, view, dados);
});
