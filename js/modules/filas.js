// PRONTUS — filas de trabalho por papel. Cada equipe vê só o que é dela, na ordem em que o
// trabalho aparece no fluxo.
//
// A tela escolhe a fila à esquerda e mostra os itens em largura inteira à direita. O formato
// anterior — uma caixa por fila, lado a lado — cortava cada lista em "e mais 12…" e obrigava a
// abrir outra tela para ver o resto.
import * as F from '../fluxo.js';
import { listar, pacientePor } from '../dados.js';
import { start, h, run, pageHead, empty, badge, icon, desde, corEtapa, horasNa } from '../ui.js';
import { PAPEIS } from '../permissoes.js';

const ROOT = new URL('../../', import.meta.url).href;

/**
 * Definição das filas por papel: { titulo, dica, itens }. Os nomes são os do processo da clínica,
 * não inventados aqui, e a ordem é a do fluxograma.
 */
function filasDoPapel(papel, D) {
  const ab = D.sols.filter(F.aberta);
  const etapa = (...e) => ab.filter((s) => e.includes(s.etapa));
  const movs = (s) => D.movimentos.filter((m) => m.solicitacao_id === s.id).map((m) => m.tipo);
  const docEmitido = (s) => D.documentos.some((x) => x.solicitacao_id === s.id && x.estado === 'emitido');
  const entrega = (s) => D.entregas.find((e) => e.solicitacao_id === s.id);

  const porPapel = {
    callcenter: [
      ['Novas solicitações', 'Registradas e ainda sem pedido de prontuário', etapa('aberta', 'em_triagem')],
      ['Casos em andamento', 'Já com a equipe, aguardando outra etapa', etapa('aguardando_prontuario', 'prontuario_em_transito', 'prontuario_na_recepcao', 'aguardando_medico')],
      ['Respostas recebidas a conferir', 'Retorno do médico publicado no grupo', etapa('aguardando_contato_paciente').filter((s) => !D.comunicacoes.some((c) => c.solicitacao_id === s.id && c.tipo === 'conferencia'))],
      ['Pacientes a contatar', 'Precisam ser avisados do retorno ou da receita', etapa('aguardando_contato_paciente')],
      ['Entregas a confirmar', 'Envio tentado ou retirada orientada, sem confirmação', etapa('aguardando_entrega').filter((s) => { const e = entrega(s); return e && !F.ENTREGA_TERMINAL.includes(e.estado); })],
      ['Esclarecimentos pedidos pelo médico', 'O médico precisa de mais informação', etapa('aguardando_esclarecimento')],
    ],
    arquivo: [
      ['Prontuários para localizar', 'Pedido publicado, ainda não encontrado', etapa('aguardando_prontuario').filter((s) => !movs(s).includes('localizado'))],
      ['Prontuários a separar', 'Localizados, falta retirar', etapa('aguardando_prontuario').filter((s) => movs(s).includes('localizado') && !movs(s).includes('retirado'))],
      ['Entregas pendentes à Recepção', 'Retirados, falta levar', etapa('aguardando_prontuario').filter((s) => movs(s).includes('retirado') && !movs(s).includes('entregue'))],
      ['Prontuários a receber de volta', 'A Recepção já devolveu, falta confirmar', D.pronts.filter((p) => p.local === 'em_transito_para_arquivo')],
      ['Arquivamentos pendentes', 'Devolução recebida, falta arquivar', D.pronts.filter((p) => p.local === 'arquivo' && p.solicitacao_id)],
      ['Não localizados', 'Precisam de tratativa com o Call Center', D.pronts.filter((p) => p.local === 'nao_localizado')],
    ],
    recepcao: [
      ['Prontuários a confirmar', 'O arquivo entregou, falta você confirmar o recebimento', etapa('prontuario_em_transito')],
      ['Conferir e encaminhar ao médico', 'Prontuário em mãos', etapa('prontuario_na_recepcao')],
      ['Respostas e receitas a receber', 'O médico registrou; avise o grupo', etapa('retorno_disponivel')],
      ['Devoluções pendentes', 'Prontuário com você ou com o médico', D.pronts.filter((p) => ['recepcao', 'com_medico'].includes(p.local))],
      ['Retiradas físicas a confirmar', 'Paciente orientado a retirar na clínica', etapa('aguardando_entrega').filter((s) => { const e = entrega(s); return e?.modo === 'fisica' && e.estado !== 'retirada_confirmada'; })],
    ],
    medico: [
      ['Casos encaminhados para avaliação', 'Aguardando a sua análise', etapa('aguardando_medico')],
      ['Casos que precisam de esclarecimento', 'Você pediu informação e ainda não voltou', etapa('aguardando_esclarecimento')],
      ['Receitas emitidas aguardando a Recepção', 'Já decididas, seguindo o fluxo', etapa('retorno_disponivel').filter(docEmitido)],
    ],
    admin_empresa: [
      ['Tudo em aberto', 'Visão de coordenação', ab],
      ['Prontuários fora do arquivo', 'Pendência administrativa', D.pronts.filter((p) => p.local !== 'arquivo')],
      ['Entregas sem confirmação', 'Risco de caso parado', D.entregas.filter((e) => !F.ENTREGA_TERMINAL.includes(e.estado) && e.estado !== 'nao_aplicavel')],
    ],
    admin_tecnico: [['Nada operacional', 'O suporte técnico não participa do fluxo de atendimento', []]],
  };
  return (porPapel[papel] || []).map(([titulo, dica, itens]) => ({ titulo, dica, itens }));
}

export const init = () => start('filas/', 'Minha fila', async (ctx, view) => {
  const [sols, pronts, movimentos, documentos, comunicacoes, entregas, tarefas] = await Promise.all([
    run(listar('solicitacoes')), run(listar('prontuarios')), run(listar('movimentos')),
    run(listar('documentos')), run(listar('comunicacoes')), run(listar('entregas')), run(listar('tarefas')),
  ]);
  const D = { sols, pronts, movimentos, documentos, comunicacoes, entregas, tarefas };
  const papel = ctx.papeis[0];
  const filas = filasDoPapel(papel, D);
  const total = filas.reduce((n, f) => n + f.itens.length, 0);
  const verPac = ctx.podeCompleto('paciente_identificacao') || ctx.pode('paciente_identificacao');

  /** Um item de fila é uma solicitação OU um prontuário: a linha se adapta aos dois. */
  const linha = (it) => {
    if (it.protocolo) {
      const pac = pacientePor(it.paciente_id);
      const tarde = horasNa(it.etapa_desde) > 24;
      return h('div', { class: 'item' },
        h('div', {},
          h('a', { class: 'id', href: ROOT + `solicitacoes/detalhe.html?id=${it.id}` }, '#' + it.protocolo),
          h('div', { class: 'sub' }, F.TIPO_CURTO[it.tipo], verPac && pac ? ' · ' + pac.nome : '')),
        h('div', { class: 'o' }, F.proximaAcao(it).texto),
        h('div', { class: 'st' },
          it.prioridade === 'alta' ? badge('Alta', 'crit') : null,
          badge(F.ETAPAS[it.etapa], corEtapa(it.etapa)),
          h('span', { class: 'age' + (tarde ? ' tarde' : '') }, desde(it.etapa_desde))));
    }
    const pac = pacientePor(it.paciente_id);
    const sol = it.solicitacao_id ? sols.find((s) => s.id === it.solicitacao_id) : null;
    return h('div', { class: 'item' },
      h('div', {},
        h('span', { class: 'id' }, it.codigo),
        h('div', { class: 'sub' }, `estante ${it.local_arquivo}${verPac && pac ? ' · ' + pac.nome : ''}`)),
      h('div', { class: 'o' }, sol ? h('span', {}, 'Protocolo ', h('b', {}, '#' + sol.protocolo), ' · ', F.ETAPAS[sol.etapa]) : 'Sem solicitação associada'),
      h('div', { class: 'st' },
        badge(F.LOCAIS[it.local], it.local === 'arquivo' ? 'ok' : it.local === 'nao_localizado' ? 'crit' : 'warn'),
        sol ? h('a', { class: 'btn sm', href: ROOT + `solicitacoes/detalhe.html?id=${sol.id}` }, 'Abrir') : null));
  };

  // A fila aberta por padrão é a primeira que tem trabalho: quem abre a tela já cai no que importa.
  let atual = Math.max(0, filas.findIndex((f) => f.itens.length));
  const corpo = h('section', { class: 'panel' });
  const rail = h('div', { class: 'qrail', role: 'tablist', 'aria-label': 'Filas do seu papel' });

  function pintar() {
    rail.replaceChildren(filas.map((f, i) => h('button', {
      class: 'q' + (i === atual ? ' on' : '') + (f.itens.length ? '' : ' vazia'),
      type: 'button', role: 'tab', 'aria-selected': String(i === atual),
      onclick: () => { atual = i; pintar(); },
    },
    h('span', {}, h('span', { class: 't' }, f.titulo), h('span', { class: 'd' }, f.dica)),
    h('span', { class: 'n' }, String(f.itens.length)))));

    const f = filas[atual];
    corpo.replaceChildren(
      h('div', { class: 'ph' },
        h('div', {}, h('h2', {}, f?.titulo || 'Fila'), h('p', { class: 'micro muted' }, f?.dica || '')),
        badge(`${f?.itens.length || 0} ${f?.itens.length === 1 ? 'item' : 'itens'}`, f?.itens.length ? 'info' : 'dim')),
      h('div', { class: 'pb' }, f?.itens.length
        ? f.itens.map(linha)
        : h('p', { class: 'small muted' }, 'Nada nesta fila agora. As outras filas do seu papel estão à esquerda.')));
  }

  view.append(
    pageHead(PAPEIS[papel], 'Minha fila', total
      ? `${total} ${total === 1 ? 'item esperando por você' : 'itens esperando por você'}, na ordem do fluxo.`
      : 'Nada pendente para o seu papel agora.'),
    total === 0 && !filas.length
      ? empty('Este papel não participa do fluxo de atendimento. Troque de papel na barra superior para ver as outras filas.')
      : h('div', { class: 'split' }, rail, corpo),
    h('p', { class: 'micro muted', style: 'margin-top:20px' }, icon('check'),
      ' Cada fila é um filtro sobre os mesmos registros: nada aqui é uma cópia que possa ficar desatualizada.'),
  );
  if (filas.length) pintar();
});
