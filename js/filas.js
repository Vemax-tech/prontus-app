// PRONTUS — quais filas de trabalho existem para cada papel, e como se repartem entre
// "Fila atual" (sem dono) e "Minha fila" (de quem assumiu).
//
// Mora aqui, fora de js/modules/, porque DUAS coisas dependem desta definição: a tela de filas e o
// número que aparece no menu. Enquanto cada uma contava do seu jeito, o menu dizia 4 e a tela dizia
// 16 — e nenhum dos dois estava errado isoladamente: eram contas diferentes com o mesmo rótulo.
//
// ATENÇÃO AO CONTAR: as filas SE SOBREPÕEM de propósito. O mesmo caso aparece em "Respostas
// recebidas a conferir" e em "Pacientes a contatar", porque são duas leituras do mesmo trabalho.
// Somar os contadores das filas conta o caso duas vezes — por isso todo total aqui passa por um
// Set de ids. É puro e sem DOM, como js/fluxo.js e js/permissoes.js.
import * as F from './fluxo.js';
import { listar } from './dados.js';

/** As sete listas que cada tela de fila precisa, numa chamada. Vira uma view/RPC no banco. */
export async function dadosDasFilas() {
  const [sols, pronts, movimentos, documentos, comunicacoes, entregas, tarefas] = await Promise.all([
    listar('solicitacoes'), listar('prontuarios'), listar('movimentos'),
    listar('documentos'), listar('comunicacoes'), listar('entregas'), listar('tarefas'),
  ].map((p) => p.then((r) => r.data || [])));
  return { sols, pronts, movimentos, documentos, comunicacoes, entregas, tarefas };
}

/**
 * Definição das filas por papel: { titulo, dica, itens }. Os nomes são os do processo da clínica,
 * não inventados aqui, e a ordem é a do fluxograma.
 */
export function filasDoPapel(papel, D) {
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

/**
 * Reparte uma fila entre o que ninguém pegou, o que é do usuário e o que é de outra pessoa.
 * Itens de custódia (prontuários) não têm dono: a trilha do prontuário é controlada pelos
 * registros de movimentação, não por posse de caso, e misturar os dois eixos é o que o sistema
 * evita em todo lugar. Eles ficam sempre como trabalho da equipe.
 */
export function repartir(fila, ator) {
  const livres = [], meus = [], assumidos = [], custodia = [];
  for (const it of fila.itens) {
    if (!it.protocolo) custodia.push(it);
    else if (it.assumido_por === ator) meus.push(it);
    else if (it.assumido_por) assumidos.push(it);
    else livres.push(it);
  }
  return { ...fila, livres, meus, assumidos, custodia };
}

/** Itens distintos de um conjunto de listas — o Set é o que impede a contagem dobrada. */
const distintos = (listas) => new Set(listas.flat().map((it) => it.id)).size;

/**
 * Os dois números do menu, contados EXATAMENTE como as duas telas contam: sem repetir o caso que
 * aparece em mais de uma fila.
 */
export function contarFilas(papel, ator, D) {
  const partes = filasDoPapel(papel, D).map((f) => repartir(f, ator));
  return {
    atual: distintos(partes.map((f) => [...f.livres, ...f.custodia])),
    minha: distintos(partes.map((f) => f.meus)),
  };
}
