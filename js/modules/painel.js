// PRONTUS — visão geral operacional. Todos os números saem dos dados; nenhum é decorativo, e cada
// indicador mostra embaixo o critério de contagem. Indicador sem critério é opinião.
import * as F from '../fluxo.js';
import { listar, configAtual } from '../dados.js';
import { situacao, atrasadas, explicar } from '../prazos.js';
import { start, h, run, pageHead, badge, stat, stats, rowbar, nota, icon, desde, corEtapa, horasNa } from '../ui.js';
import { PAPEIS } from '../permissoes.js';

const ROOT = new URL('../../', import.meta.url).href;
const media = (ns) => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null);
const horas = (n) => (n == null ? '—' : n < 24 ? `${Math.round(n)} h` : `${(n / 24).toFixed(1)} d`);
const painel = (titulo, extra, ...corpo) => h('section', { class: 'panel' },
  h('div', { class: 'ph' }, h('h2', {}, titulo), extra),
  h('div', { class: 'pb' }, corpo));

export const init = () => start('', 'Visão geral', async (ctx, view) => {
  const [sols, tarefas, pronts, docs, entregas] = await Promise.all([
    run(listar('solicitacoes')), run(listar('tarefas')), run(listar('prontuarios')),
    run(listar('documentos')), run(listar('entregas')),
  ]);
  const metas = configAtual().metas;
  const abertas = sols.filter(F.aberta);
  const emEtapa = (...e) => abertas.filter((s) => e.includes(s.etapa));
  const minimo = !ctx.podeCompleto('dashboard');   // Arquivo e Médico veem a versão reduzida
  const lista = (filtro) => ROOT + 'solicitacoes/' + (filtro ? '?' + filtro : '');

  const prontPendentes = pronts.filter((p) => p.local !== 'arquivo');
  const receitasProntas = emEtapa('retorno_disponivel').filter((s) => docs.some((d) => d.solicitacao_id === s.id && d.estado === 'emitido'));

  // ---------- linha de indicadores
  const indicadores = minimo
    ? [stat({ k: 'Aguardando prontuário', v: emEtapa('aguardando_prontuario', 'prontuario_em_transito').length, c: 'etapa aguardando ou em trânsito', tipo: 'warn', href: lista('etapa=aguardando_prontuario') }),
      stat({ k: 'Fora do arquivo', v: prontPendentes.length, c: 'custódia diferente de "no arquivo"', tipo: prontPendentes.length ? 'warn' : '', href: ROOT + 'prontuarios/' }),
      stat({ k: 'Aguardando médico', v: emEtapa('aguardando_medico', 'aguardando_esclarecimento').length, c: 'inclui pedidos de esclarecimento', href: lista('etapa=aguardando_medico') }),
      stat({ k: 'Abertas', v: abertas.length, c: 'etapa não é concluída nem cancelada', href: lista('') })]
    : [stat({ k: 'Abertas', v: abertas.length, c: 'etapa não é concluída nem cancelada', href: lista('') }),
      // No lugar de "Em atendimento", que era derivável de "Abertas" e não pedia ação nenhuma:
      // o indicador que o plano pede desde o MVP. O critério embaixo diz de onde vem o número —
      // é a meta que a clínica definiu, não um prazo que o sistema inventou.
      stat({ k: 'Paradas além da meta', v: atrasadas(abertas, metas).length, c: 'passaram do prazo definido em Configurações', tipo: atrasadas(abertas, metas).length ? 'crit' : 'ok', href: lista('prazo=atrasada') }),
      stat({ k: 'Aguardando prontuário', v: emEtapa('aguardando_prontuario', 'prontuario_em_transito').length, c: 'aguardando ou em trânsito', tipo: 'warn', href: lista('etapa=aguardando_prontuario') }),
      stat({ k: 'Aguardando Recepção', v: emEtapa('prontuario_na_recepcao', 'retorno_disponivel').length, c: 'conferir ou receber retorno', href: lista('etapa=prontuario_na_recepcao') }),
      stat({ k: 'Aguardando médico', v: emEtapa('aguardando_medico', 'aguardando_esclarecimento').length, c: 'inclui esclarecimentos', tipo: 'warn', href: lista('etapa=aguardando_medico') }),
      stat({ k: 'Receitas a comunicar', v: receitasProntas.length, c: 'retorno disponível com documento emitido', tipo: receitasProntas.length ? 'ok' : '', href: lista('etapa=retorno_disponivel') }),
      stat({ k: 'Aguardando contato', v: emEtapa('aguardando_contato_paciente').length, c: 'paciente ainda não foi informado', href: lista('etapa=aguardando_contato_paciente') }),
      stat({ k: 'Prontuários a devolver', v: prontPendentes.length, c: 'independe da etapa da solicitação', tipo: prontPendentes.length ? 'warn' : '', href: ROOT + 'prontuarios/' })];

  // ---------- pedidos parados além da meta (seção 6 do plano: "pedido parado dá alerta")
  // Ordenado pelo EXCEDENTE, não pelo tempo total: o que passou mais da própria meta é o que
  // precisa de atenção primeiro. Uma entrega parada há 20 h com meta de 24 h não é um problema;
  // um caso com o médico há 5 h, com meta de 2 h, é.
  const atrasos = atrasadas(abertas, metas);
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
      ? h('div', { style: 'margin-top:10px' }, naLista.map((s) => {
        const sit = situacao(s, metas);
        return h('div', { class: 'item' },
          h('div', {},
            h('a', { class: 'id', href: ROOT + `solicitacoes/detalhe.html?id=${s.id}` }, '#' + s.protocolo),
            h('div', { class: 'sub' }, F.TIPO_CURTO[s.tipo])),
          h('div', { class: 'o' }, F.proximaAcao(s).texto,
            sit.estado !== 'sem_meta' ? h('div', { class: 'micro muted' }, explicar(s, metas)) : null),
          h('div', { class: 'st' },
            sit.rotulo ? badge(sit.rotulo, sit.estado === 'atrasada' ? 'crit' : 'warn') : null,
            badge(F.ETAPAS[s.etapa], corEtapa(s.etapa)),
            h('span', { class: 'age' + (sit.estado === 'atrasada' ? ' tarde' : '') }, desde(s.etapa_desde))));
      }))
      : h('p', { class: 'small muted', style: 'margin-top:10px' }, 'Nada em aberto.'));

  // ---------- onde o trabalho está parado (uma série: o comprimento é a quantidade)
  const porEtapa = Object.entries(F.ETAPAS)
    .map(([e, rot]) => ({ e, rot, n: abertas.filter((s) => s.etapa === e).length }))
    .filter((x) => x.n);
  const maxEtapa = Math.max(1, ...porEtapa.map((x) => x.n));
  const ondeEsta = painel('Onde o trabalho está parado', h('span', { class: 'micro muted' }, `${abertas.length} em aberto`),
    porEtapa.length
      ? h('div', { style: 'display:grid;gap:9px' }, porEtapa.map((x) => rowbar(x.rot, x.n, maxEtapa)))
      : h('p', { class: 'small muted' }, 'Nada em aberto.'));

  // ---------- pendências por equipe
  const pend = tarefas.filter((t) => t.estado === 'pendente');
  const porPapel = ['callcenter', 'arquivo', 'recepcao', 'medico'].map((p) => ({ p, n: pend.filter((t) => t.papel_responsavel === p).length }));
  const equipes = painel('Pendências por equipe', h('span', { class: 'micro muted' }, `${pend.length} tarefas`),
    h('ul', { class: 'ul-list' }, porPapel.map(({ p, n }) => h('li', { class: 'row between' },
      h('span', {}, PAPEIS[p]),
      n ? badge(`${n} pendente${n > 1 ? 's' : ''}`, n > 3 ? 'warn' : '') : badge('em dia', 'ok')))));

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
  const tempos = painel('Tempos', null, h('dl', { class: 'dl' },
    h('dt', {}, 'Média até concluir'), h('dd', { class: 'num' }, horas(tConclusao), h('div', { class: 'micro muted' }, `${concl.length} solicitações concluídas`)),
    h('dt', {}, 'Média na etapa atual'), h('dd', { class: 'num' }, horas(tEspera), h('div', { class: 'micro muted' }, `${abertas.length} em aberto`)),
    h('dt', {}, 'Entregas sem confirmação'), h('dd', { class: 'num' }, String(semConfirmacao),
      h('div', { class: 'micro muted' }, 'envio tentado não conta: tentativa não é entrega'))));

  view.append(
    pageHead(PAPEIS[ctx.papeis[0]], 'Visão geral',
      minimo ? 'Indicadores reduzidos ao necessário para a sua função.' : `Olá, ${ctx.nome.split(' ')[0]}. Todos os números vêm dos registros — nenhum é ilustrativo.`),
    stats(indicadores),
    h('div', { class: 'det' },
      h('div', { class: 'main' }, paradas, minimo ? null : volume),
      h('div', { class: 'aside' }, ondeEsta, equipes, minimo ? null : tempos)),
    h('p', { class: 'micro muted', style: 'margin-top:22px' }, icon('clock'), ' O critério de contagem de cada indicador está escrito embaixo do próprio número.'),
  );
});
