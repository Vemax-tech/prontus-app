// PRONTUS — central de solicitações: listagem completa, com busca, filtros, ordenação e paginação.
// É a tela onde a operação enxerga tudo de uma vez, e os dois fluxos convivem sem se misturar.
import * as F from '../fluxo.js';
import { listar, abrirSolicitacao, possivelDuplicidade, nomeDe, pacientePor, prontuarioPor, configAtual } from '../dados.js';
import { situacao, explicar } from '../prazos.js';
import { start, h, run, pageHead, empty, badge, dataTable, filtros, contem, formModal, modal, fmtDate, qs, icon, desde, corEtapa, horasNa } from '../ui.js';

const ROOT = new URL('../../', import.meta.url).href;
const PRIO = { alta: 'Alta', normal: 'Normal', baixa: 'Baixa' };

export const init = () => start('solicitacoes/', 'Solicitações', async (ctx, view) => {
  const canAbrir = ctx.pode('solicitacao_abrir', 'editar');
  const verPaciente = ctx.podeCompleto('paciente_identificacao');
  const [sols, pacientes, pronts, tarefas, coms, entregas, docs] = await Promise.all([
    run(listar('solicitacoes')), run(listar('pacientes')), run(listar('prontuarios')),
    run(listar('tarefas')), run(listar('comunicacoes')), run(listar('entregas')), run(listar('documentos')),
  ]);
  const lista = [...sols].sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em));

  // 'dono' = filtro de posse: vazio (todos), 'eu' ou 'livre'.
  const metas = configAtual().metas;
  // 'prazo' = situação perante a meta da etapa; chega pronto do painel por ?prazo=atrasada.
  const f = { q: '', tipo: '', dono: '', prazo: qs('prazo') || '', etapa: qs('etapa') || '', prio: '', papel: '', abertas: qs('etapa') || qs('prazo') ? '' : '1' };
  const st = { sort: 'etapa_desde', dir: 1, page: 0 };
  const body = h('div');

  const nomePac = (s) => pacientePor(s.paciente_id)?.nome || '—';
  const pacCell = (s) => (verPaciente ? nomePac(s) : h('span', { class: 'small muted' }, 'reduzido'));
  const tarefasDe = (s) => tarefas.filter((t) => t.solicitacao_id === s.id && t.estado === 'pendente');
  const prontDe = (s) => prontuarioPor(s.prontuario_id);
  const ultimaCom = (s) => coms.filter((c) => c.solicitacao_id === s.id).sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em))[0];
  const entregaDe = (s) => entregas.find((e) => e.solicitacao_id === s.id);

  // ---------------------------------------------------------------- nova solicitação
  // As frases que a clínica ouve o dia inteiro, por tipo de pedido. Encurtam a digitação de quem
  // está com o paciente na linha, e padronizam o texto — e é o texto padronizado que, mais tarde,
  // permite responder "por que as pessoas ligam?" com número em vez de impressão.
  const FRASES = {
    pedido_receita: ['Receita de uso contínuo acabou.', 'Perdeu a receita.', 'A receita venceu.', 'Precisa de uma via para o plano.', 'Vai viajar e precisa da receita antes.'],
    duvida_correcao: ['Dosagem ilegível na receita.', 'Dúvida sobre o horário de tomar.', 'Nome do medicamento está errado.', 'A farmácia recusou a receita.', 'Quer saber se pode trocar por genérico.'],
  };
  const campos = (tipo) => [
    // Digitar, não rolar: com o cadastro inteiro da clínica aqui dentro, uma lista de opções é
    // uma lista que ninguém percorre. A data de nascimento fica no rótulo porque é o que separa
    // dois pacientes de mesmo nome — que numa clínica existem.
    { name: 'paciente_id', label: 'Paciente', type: 'buscavel', required: true, placeholder: 'Digite o nome do paciente…', options: pacientes.map((p) => [p.id, `${p.nome} · nasc. ${fmtDate(p.nascimento)}`]), hint: 'Comece a digitar o nome e escolha na lista.' },
    { name: 'tipo', label: 'Tipo de solicitação', type: 'select', value: tipo, options: Object.entries(F.TIPOS), hint: 'Os dois fluxos são diferentes e não se transformam um no outro.' },
    { name: 'relato', label: 'Relato do paciente', type: 'textarea', required: true, maxlength: 2000, chips: FRASES[tipo] || [], hint: 'O que o paciente disse. Os botões acima escrevem as frases de sempre; o resto é texto livre.' },
    { name: 'prioridade', label: 'Prioridade', type: 'select', value: 'normal', options: Object.entries(PRIO) },
  ];
  const nova = (tipo = 'duvida_correcao') => formModal({
    title: 'Registrar solicitação', submitLabel: 'Registrar', fields: campos(tipo),
    onSubmit: async (v) => {
      const dups = possivelDuplicidade(v);
      if (dups.length && !(await confirmaDuplicidade(dups))) return false;
      const r = await run(abrirSolicitacao({ ...v, papeis: ctx.papeis, ator: ctx.ator }), 'Solicitação registrada.');
      if (!r) return false;
      location.href = ROOT + `solicitacoes/detalhe.html?id=${r.id}`;
    },
  });
  /** RF-04: duplicidade provável avisa, mas não bloqueia solicitação legítima do mesmo paciente. */
  const confirmaDuplicidade = (dups) => new Promise((res) => {
    modal('Possível duplicidade', h('div', {},
      h('p', {}, 'Este paciente já tem solicitação aberta do mesmo tipo nas últimas 24 horas:'),
      h('ul', { class: 'ul-list', style: 'margin:12px 0' }, dups.map((d) => h('li', {},
        h('a', { class: 't', href: ROOT + `solicitacoes/detalhe.html?id=${d.id}` }, `#${d.protocolo}`), ' · ', F.ETAPAS[d.etapa], ' · aberta ', desde(d.criado_em)))),
      h('p', { class: 'small muted' }, 'Pode ser um pedido legítimo diferente. A decisão é sua — o sistema só avisa.')),
    (close) => h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { res(false); close(); } }, 'Ver a existente'),
      h('button', { class: 'btn primary', onclick: () => { res(true); close(); } }, 'Registrar mesmo assim')), () => res(false));
  });

  // ---------------------------------------------------------------- colunas
  const todas = [
    { key: 'protocolo', label: 'Protocolo', sort: (s) => s.protocolo, render: (s) => h('span', {},
      h('a', { class: 't mono', href: ROOT + `solicitacoes/detalhe.html?id=${s.id}` }, '#' + s.protocolo),
      h('div', { class: 'small muted' }, F.TIPO_CURTO[s.tipo])) },
    { key: 'paciente', label: 'Paciente', sort: (s) => nomePac(s).toLowerCase(), render: pacCell },
    { key: 'etapa', label: 'Etapa atual', sort: (s) => Object.keys(F.ETAPAS).indexOf(s.etapa), render: (s) => badge(F.ETAPAS[s.etapa], corEtapa(s.etapa)) },
    // Ordena pelo EXCEDENTE sobre a meta, não pelo tempo bruto: o que passou mais do próprio
    // prazo vem primeiro. Sem meta, cai para o tempo parado, que é o que se sabe.
    { key: 'etapa_desde',
      label: 'Tempo na etapa',
      sort: (s) => { const x = situacao(s, metas); return x.meta === null ? -horasNa(s.etapa_desde) / 1e3 : -(x.horas - x.meta); },
      render: (s) => {
        if (!F.aberta(s)) return h('span', { class: 'small muted' }, '—');
        const sit = situacao(s, metas);
        const cor = sit.estado === 'atrasada' ? 'color:var(--crit);font-weight:600'
          : sit.estado === 'atencao' ? 'color:var(--warn);font-weight:600' : null;
        return h('span', {},
          h('span', { style: cor }, desde(s.etapa_desde)),
          sit.rotulo ? h('div', { class: 'micro', style: 'color:var(--ink-3)' }, explicar(s, metas)) : null);
      } },
    { key: 'prox', label: 'Próxima ação de', sort: (s) => F.proximaAcao(s).papel || 'zz', render: (s) => {
      const p = F.proximaAcao(s);
      return p.papel ? badge(p.papel, 'dim') : h('span', { class: 'small muted' }, '—');
    } },
    // No lugar de um botão "Abrir" — a linha inteira já abre o caso, e a coluna extra empurrava
    // a tabela para fora da tela em monitor de 1280. Aqui vai o que faltava: o nome de quem está
    // com o caso agora, que é a pergunta que a lista recebe o dia todo.
    { key: 'dono', label: 'Com quem está', sort: (s) => (s.assumido_por ? nomeDe(s.assumido_por).toLowerCase() : 'zz'), render: (s) => {
      if (!F.aberta(s)) return h('span', { class: 'small muted' }, '—');
      if (!s.assumido_por) return badge('sem dono', 'warn');
      return h('span', { class: 'small' }, nomeDe(s.assumido_por), s.assumido_por === ctx.ator ? h('div', { class: 'micro' , style: 'color:var(--ok)' }, 'é você') : null);
    } },
    { key: 'pend', label: 'Pendências', sort: (s) => -tarefasDe(s).length, render: (s) => {
      const n = tarefasDe(s).length, pr = prontDe(s);
      return h('span', { class: 'chips' },
        n ? badge(`${n} tarefa${n > 1 ? 's' : ''}`, 'warn') : null,
        F.prontuarioPendente(pr) ? badge('prontuário fora do arquivo', 'warn') : null,
        !n && !F.prontuarioPendente(pr) ? h('span', { class: 'small muted' }, '—') : null);
    } },
    { key: 'com', label: 'Comunicação', render: (s) => {
      const c = ultimaCom(s);
      if (!c) return h('span', { class: 'small muted' }, 'nenhuma');
      return h('span', { class: 'small' }, F.COM_TIPOS[c.tipo], h('div', { class: 'small muted' }, F.RESULTADOS[c.resultado]));
    } },
    { key: 'entrega', label: 'Entrega', render: (s) => {
      if (s.tipo !== 'pedido_receita') return h('span', { class: 'small muted' }, 'não se aplica');
      const e = entregaDe(s);
      if (!e) return h('span', { class: 'small muted' }, '—');
      const falta = !F.ENTREGA_TERMINAL.includes(e.estado);
      return h('span', { class: 'small', style: falta ? 'color:var(--crit)' : null }, F.ENTREGA_ESTADOS[e.estado], h('div', { class: 'small muted' }, F.ENTREGA_MODOS[e.modo]));
    } },
    { key: 'prio', label: 'Prioridade', sort: (s) => ['alta', 'normal', 'baixa'].indexOf(s.prioridade), render: (s) => (s.prioridade === 'normal' ? h('span', { class: 'small muted' }, '—') : badge(PRIO[s.prioridade], s.prioridade === 'alta' ? 'crit' : 'dim')) },
    { key: 'criado', label: 'Aberta em', sort: (s) => s.criado_em, render: (s) => h('span', { class: 'small' }, fmtDate(s.criado_em), h('div', { class: 'small muted' }, nomeDe(s.aberta_por))) },
  ];

  // Quem não acompanha o retorno clínico (o Arquivo) só lida com a pasta física: contato com o
  // paciente, entrega do documento e quem abriu o pedido são de outras equipes e só atrapalham a lista.
  const soPasta = !ctx.pode('avaliacao_existencia');
  const cols = soPasta ? todas.filter((c) => !['com', 'entrega', 'criado'].includes(c.key)) : todas;

  function draw() {
    const shown = lista.filter((s) => (!f.abertas || F.aberta(s))
      && (!f.tipo || s.tipo === f.tipo)
      && (!f.etapa || s.etapa === f.etapa)
      && (!f.prio || s.prioridade === f.prio)
      && (!f.papel || F.proximaAcao(s).papel === f.papel)
      && (!f.dono || (f.dono === 'eu' ? s.assumido_por === ctx.ator : !s.assumido_por && F.aberta(s)))
      && (!f.prazo || situacao(s, metas).estado === f.prazo)
      && contem([String(s.protocolo), verPaciente ? nomePac(s) : '', F.TIPOS[s.tipo]], f.q));
    if (!shown.length) { body.replaceChildren(empty('Nenhuma solicitação com esses filtros.')); return; }
    body.replaceChildren(
      h('p', { class: 'small muted', style: 'margin-bottom:8px' }, `${shown.length} de ${lista.length} solicitações`),
      dataTable({ cols, rows: shown, state: st, size: 12, onState: draw, vazio: empty('Nada aqui'), // "A linha fica vermelha na fila" (plano, seção 6) — agora pela meta da clínica, não por um
      // limite fixo de 48 h que o código tinha escolhido sozinho.
      rowClass: (s) => (situacao(s, metas).estado === 'atrasada' ? 'late' : null) }));
  }

  view.append(
    pageHead('Operação', 'Solicitações', 'Dúvida ou correção na receita e pedido de nova receita. Os dois fluxos convivem aqui, sem se misturar.',
      canAbrir && h('button', { class: 'btn', onclick: () => nova('duvida_correcao') }, icon('check'), 'Dúvida ou correção'),
      canAbrir && h('button', { class: 'btn primary', onclick: () => nova('pedido_receita') }, icon('file'), 'Pedido de receita', h('span', { class: 'kbd' }, 'N'))),
    !verPaciente && h('p', { class: 'note', style: 'margin-bottom:14px' }, 'O seu papel vê o paciente de forma reduzida: o nome aparece só onde é necessário para a sua função.'),
    filtros([
      { tipo: 'busca', chave: 'q', placeholder: 'Buscar por protocolo ou paciente…' },
      { tipo: 'select', chave: 'tipo', rotulo: 'Todos os tipos', opcoes: Object.entries(F.TIPOS) },
      { tipo: 'select', chave: 'etapa', rotulo: 'Todas as etapas', opcoes: Object.entries(F.ETAPAS) },
      { tipo: 'select', chave: 'papel', rotulo: 'Próxima ação de qualquer um', opcoes: [['Call Center', 'Call Center'], ['Arquivo', 'Arquivo'], ['Recepção', 'Recepção']] },
      { tipo: 'select', chave: 'dono', rotulo: 'Qualquer responsável', opcoes: [['eu', 'Os que eu assumi'], ['livre', 'Sem dono']] },
      { tipo: 'select', chave: 'prazo', rotulo: 'Qualquer prazo', opcoes: [['atrasada', 'Paradas além da meta'], ['atencao', 'Perto do prazo'], ['sem_meta', 'Etapa sem meta']] },
      { tipo: 'select', chave: 'prio', rotulo: 'Todas as prioridades', opcoes: Object.entries(PRIO) },
      { tipo: 'select', chave: 'abertas', rotulo: 'Abertas e encerradas', opcoes: [['1', 'Só em aberto']] },
    ], f, draw),
    body,
    canAbrir && h('p', { class: 'micro muted', style: 'margin-top:20px' }, icon('check'),
      ' Quem atende em série não deveria precisar do mouse: ', h('b', {}, 'N'), ' abre um pedido de receita,'
      + ' ', h('b', {}, '/'), ' pula para a busca e ', h('b', {}, 'Esc'), ' fecha o que estiver aberto.'));
  draw();

  // ATALHOS DE TECLADO. Numa mesa que atende oitenta ligações por dia, a mão que sai do teclado
  // para o mouse e volta é o custo que mais se repete no sistema inteiro — e é o único que
  // nenhuma tela bonita resolve. `/` para buscar é a convenção que a equipe já usa no navegador
  // e no chat; `N` abre o pedido mais comum, e a tecla aparece escrita no próprio botão, porque
  // atalho que ninguém descobre não existe.
  const digitando = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')
    || Boolean(document.querySelector('.ov'));
  const atalhos = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || digitando()) return;
    if (e.key === '/') {
      const busca = view.querySelector('.toolbar input[type="search"]');
      if (!busca) return;
      e.preventDefault(); busca.focus(); busca.select();
    } else if ((e.key === 'n' || e.key === 'N') && canAbrir) {
      e.preventDefault(); nova('pedido_receita');
    }
  };
  document.addEventListener('keydown', atalhos);
  window.addEventListener('pagehide', () => document.removeEventListener('keydown', atalhos), { once: true });
});
