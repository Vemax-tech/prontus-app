// PRONTUS — relatórios. Agregados, sem conteúdo clínico e sem dado pessoal: a exportação sai
// identificada por protocolo, nunca por nome de paciente.
import * as F from '../fluxo.js';
import { listar } from '../dados.js';
import { start, h, run, pageHead, badge, sec, baixarCsv, icon, stat, stats, barra } from '../ui.js';
import { PAPEIS } from '../permissoes.js';

const media = (ns) => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null);
const horas = (n) => (n == null ? '—' : n < 24 ? `${Math.round(n)} h` : `${(n / 24).toFixed(1)} d`);

export const init = () => start('relatorios/', 'Relatórios', async (ctx, view) => {
  const [sols, eventos, tarefas, pronts, movimentos, entregas, coms] = await Promise.all([
    run(listar('solicitacoes')), run(listar('eventos')), run(listar('tarefas')),
    run(listar('prontuarios')), run(listar('movimentos')), run(listar('entregas')), run(listar('comunicacoes')),
  ]);
  const abertas = sols.filter(F.aberta);

  // ---------- tempo por etapa: diferença entre eventos consecutivos da mesma solicitação
  const porEtapa = {};
  for (const s of sols) {
    const evs = eventos.filter((e) => e.solicitacao_id === s.id).sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));
    for (let i = 0; i < evs.length; i++) {
      const fim = evs[i + 1] ? new Date(evs[i + 1].criado_em) : (F.aberta(s) ? new Date() : null);
      if (!fim) continue;
      const et = evs[i].para_etapa;
      const hs = (fim - new Date(evs[i].criado_em)) / 3600e3;
      (porEtapa[et] ||= []).push(hs);
    }
  }
  const linhasEtapa = Object.keys(F.ETAPAS).filter((e) => porEtapa[e]?.length).map((e) => ({
    etapa: e, rotulo: F.ETAPAS[e], n: porEtapa[e].length,
    medio: media(porEtapa[e]), max: Math.max(...porEtapa[e]),
  }));
  const maiorMedio = Math.max(...linhasEtapa.map((l) => l.medio), 1);


  const tabelaEtapas = h('div', { class: 'tw' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Etapa'), h('th', {}, 'Passagens'), h('th', {}, 'Tempo médio'), h('th', {}, 'Maior tempo'), h('th', {}, ''))),
    h('tbody', {}, linhasEtapa.map((l) => h('tr', {},
      h('td', {}, l.rotulo), h('td', {}, String(l.n)), h('td', {}, horas(l.medio)), h('td', {}, horas(l.max)),
      h('td', { style: 'min-width:140px' }, barra(l.medio, maiorMedio)))))));

  // ---------- tempo até a resposta médica e até o primeiro atendimento
  const ate = (s, etapaAlvo) => {
    const e = eventos.find((x) => x.solicitacao_id === s.id && x.para_etapa === etapaAlvo);
    return e ? (new Date(e.criado_em) - new Date(s.criado_em)) / 3600e3 : null;
  };
  const tPrimeiro = media(sols.map((s) => ate(s, 'aguardando_prontuario')).filter((x) => x != null));
  const tMedico = media(sols.map((s) => ate(s, 'retorno_disponivel')).filter((x) => x != null));
  const tComMedico = media(sols.map((s) => {
    const saiu = eventos.find((x) => x.solicitacao_id === s.id && x.para_etapa === 'com_medico');
    const voltou = eventos.find((x) => x.solicitacao_id === s.id && x.de_etapa === 'com_medico');
    return saiu && voltou ? (new Date(voltou.criado_em) - new Date(saiu.criado_em)) / 3600e3 : null;
  }).filter((x) => x != null));
  const tConclusao = media(sols.filter((s) => s.concluida_em).map((s) => (new Date(s.concluida_em) - new Date(s.criado_em)) / 3600e3));
  const reabertas = sols.filter((s) => s.reaberturas > 0);

  // ---------- entregas
  const entTotal = entregas.length;
  const entConf = entregas.filter((e) => F.ENTREGA_TERMINAL.includes(e.estado)).length;

  // ---------- movimentações de prontuário
  const movPorTipo = Object.keys(F.MOVIMENTOS).map((t) => ({ t, n: movimentos.filter((m) => m.tipo === t).length })).filter((x) => x.n);
  const foraDoArquivo = pronts.filter((p) => p.local !== 'arquivo');

  // ---------- exportação: protocolo, nunca nome de paciente
  const exportar = () => baixarCsv('prontus-solicitacoes.csv', [
    { label: 'Protocolo', val: (s) => s.protocolo },
    { label: 'Tipo', val: (s) => F.TIPOS[s.tipo] },
    { label: 'Etapa', val: (s) => F.ETAPAS[s.etapa] },
    { label: 'Prioridade', val: (s) => s.prioridade },
    { label: 'Aberta em', val: (s) => new Date(s.criado_em).toLocaleString('pt-BR') },
    { label: 'Concluida em', val: (s) => (s.concluida_em ? new Date(s.concluida_em).toLocaleString('pt-BR') : '') },
    { label: 'Horas ate concluir', val: (s) => (s.concluida_em ? Math.round((new Date(s.concluida_em) - new Date(s.criado_em)) / 3600e3) : '') },
    { label: 'Desfecho', val: (s) => (s.desfecho ? F.DESFECHOS[s.desfecho] : '') },
    { label: 'Reaberturas', val: (s) => s.reaberturas },
  ], sols);

  view.append(
    pageHead('Análise', 'Relatórios', 'Agregados por etapa, equipe e entrega. Sem conteúdo clínico e sem dado pessoal — a exportação identifica por protocolo.',
      h('button', { class: 'btn', onclick: exportar }, icon('chart'), 'Exportar CSV')),

    stats(
      stat({ k: 'Até pedir o prontuário', v: horas(tPrimeiro), c: 'da abertura ao pedido no grupo' }),
      stat({ k: 'Até a resposta médica', v: horas(tMedico), c: 'da abertura ao retorno registrado' }),
      stat({ k: 'Tempo com o médico', v: horas(tComMedico), c: 'da saída da Recepção até o retorno voltar' }),
      stat({ k: 'Até concluir', v: horas(tConclusao), c: `${sols.filter((s) => s.concluida_em).length} solicitações concluídas` }),
      stat({ k: 'Retrabalho', v: reabertas.length, c: 'solicitações reabertas', tipo: reabertas.length ? 'warn' : '' })),

    sec('Tempo por etapa', h('section', { class: 'card' },
      h('p', { class: 'small muted', style: 'margin-bottom:12px' }, 'Calculado pela diferença entre eventos consecutivos da linha do tempo. Etapas em aberto contam até agora.'),
      tabelaEtapas)),

    sec('Pendências por equipe', h('div', { class: 'grid g2' },
      h('section', { class: 'card' },
        h('h3', { style: 'margin-bottom:12px' }, 'Tarefas pendentes'),
        h('ul', { class: 'ul-list' }, ['callcenter', 'arquivo', 'recepcao'].map((p) => {
          const n = tarefas.filter((t) => t.papel_responsavel === p && t.estado === 'pendente').length;
          const tot = tarefas.filter((t) => t.papel_responsavel === p).length;
          return h('li', {}, h('div', { class: 'row between' }, h('span', {}, PAPEIS[p]), h('b', {}, `${n} de ${tot}`)), barra(n, Math.max(tot, 1)));
        }))),
      h('section', { class: 'card' },
        h('h3', { style: 'margin-bottom:12px' }, 'Onde o trabalho está parado'),
        h('ul', { class: 'ul-list' }, Object.entries(F.ETAPAS).map(([e, rot]) => {
          const n = abertas.filter((s) => s.etapa === e).length;
          return n ? h('li', { class: 'row between' }, h('span', {}, rot), badge(String(n), n > 2 ? 'warn' : 'dim')) : null;
        }).filter(Boolean))))),

    sec('Situação das entregas', h('div', { class: 'grid g2' },
      h('section', { class: 'card' },
        h('div', { class: 'row between', style: 'margin-bottom:10px' }, h('h3', {}, 'Confirmadas'), h('b', {}, `${entConf} de ${entTotal}`)),
        barra(entConf, Math.max(entTotal, 1), 'ok'),
        h('p', { class: 'small muted', style: 'margin-top:10px' }, 'Só contam estados terminais reais: enviado (com confirmação) e retirada confirmada. Envio tentado não entra.')),
      h('section', { class: 'card' },
        h('h3', { style: 'margin-bottom:12px' }, 'Por estado'),
        h('ul', { class: 'ul-list' }, Object.entries(F.ENTREGA_ESTADOS).map(([k, rot]) => {
          const n = entregas.filter((e) => e.estado === k).length;
          return n ? h('li', { class: 'row between' }, h('span', {}, rot), badge(String(n), F.ENTREGA_TERMINAL.includes(k) ? 'ok' : 'warn')) : null;
        }).filter(Boolean))))),

    sec('Movimentações de prontuário', h('div', { class: 'grid g2' },
      h('section', { class: 'card' },
        h('h3', { style: 'margin-bottom:12px' }, 'Por tipo de movimento'),
        h('ul', { class: 'ul-list' }, movPorTipo.map((m) => h('li', { class: 'row between' }, h('span', {}, F.MOVIMENTOS[m.t]), h('b', {}, String(m.n)))))),
      h('section', { class: 'card' },
        h('h3', { style: 'margin-bottom:12px' }, 'Fora do arquivo agora'),
        foraDoArquivo.length
          ? h('ul', { class: 'ul-list' }, foraDoArquivo.map((p) => h('li', { class: 'row between' }, h('span', {}, p.codigo), badge(F.LOCAIS[p.local], 'warn'))))
          : h('p', { class: 'small muted' }, 'Todos arquivados.'),
        h('p', { class: 'small muted', style: 'margin-top:10px' }, 'Pendência administrativa, independente do atendimento.')))),

    h('p', { class: 'small muted', style: 'margin-top:24px' }, 'O cumprimento de meta por etapa aparece na Visão geral, onde ele leva a uma ação. Aqui ficam os agregados — e a exportação sai identificada por protocolo, nunca por nome de paciente.'),
  );
});
