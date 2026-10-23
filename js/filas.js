// PRONTUS — quais filas de trabalho existem para cada papel, e como se repartem entre
// "Fila da equipe" (sem dono) e "Meus casos" (de quem assumiu).
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
import { listar, usuarioPor } from './dados.js';
import { situacao } from './prazos.js';

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
  const entrega = (s) => D.entregas.find((e) => e.solicitacao_id === s.id);

  const porPapel = {
    callcenter: [
      ['Novas solicitações', 'Registradas e ainda sem pedido de prontuário', etapa('aberta', 'em_triagem')],
      ['Casos em andamento', 'Já com a equipe, aguardando outra etapa', etapa('aguardando_prontuario', 'prontuario_em_transito', 'prontuario_na_recepcao', 'com_medico')],
      ['Respostas recebidas a conferir', 'Retorno do médico publicado no grupo', etapa('aguardando_contato_paciente').filter((s) => !D.comunicacoes.some((c) => c.solicitacao_id === s.id && c.tipo === 'conferencia'))],
      ['Pacientes a contatar', 'Precisam ser avisados do retorno ou da receita', etapa('aguardando_contato_paciente')],
      ['Entregas a confirmar', 'Envio tentado ou retirada orientada, sem confirmação', etapa('aguardando_entrega').filter((s) => { const e = entrega(s); return e && !F.ENTREGA_TERMINAL.includes(e.estado); })],
      ['Esclarecimentos pedidos pelo médico', 'O médico precisa de mais informação para decidir', etapa('aguardando_esclarecimento')],
    ],
    arquivo: [
      ['Prontuários para localizar', 'Pedido publicado, ainda não encontrado', etapa('aguardando_prontuario').filter((s) => !movs(s).includes('localizado'))],
      ['Prontuários a separar', 'Localizados, falta retirar', etapa('aguardando_prontuario').filter((s) => movs(s).includes('localizado') && !movs(s).includes('retirado'))],
      ['Entregas pendentes à Recepção', 'Retirados, falta levar', etapa('aguardando_prontuario').filter((s) => movs(s).includes('retirado') && !movs(s).includes('entregue'))],
      ['Prontuários a receber de volta', 'A Recepção já devolveu, falta confirmar', D.pronts.filter((p) => p.local === 'em_transito_para_arquivo')],
      ['Arquivamentos pendentes', 'Devolução recebida, falta arquivar', D.pronts.filter((p) => p.local === 'arquivo' && p.solicitacao_id)],
      ['Não localizados', 'Precisam de tratativa com o Call Center', D.pronts.filter((p) => p.local === 'nao_localizado')],
    ],
    // A Recepção é a ponte com o consultório: as duas filas que o médico tinha viraram filas dela,
    // porque o trabalho que sobrou do lado de cá é ir buscar a resposta e transcrevê-la.
    recepcao: [
      ['Prontuários a confirmar', 'O arquivo entregou, falta você confirmar o recebimento', etapa('prontuario_em_transito')],
      ['Conferir e levar ao médico', 'Prontuário em mãos, falta levar', etapa('prontuario_na_recepcao')],
      ['Respostas a buscar com o médico', 'O caso está com ele; traga a resposta e registre', etapa('com_medico')],
      ['Esclarecimentos pedidos pelo médico', 'Ele pediu mais informação antes de decidir', etapa('aguardando_esclarecimento')],
      ['Retornos a avisar no grupo', 'Já registrados; falta avisar quem vai ligar', etapa('retorno_disponivel')],
      ['Devoluções pendentes', 'Prontuário com você ou com o médico', D.pronts.filter((p) => ['recepcao', 'com_medico'].includes(p.local))],
      ['Retiradas físicas a confirmar', 'Paciente orientado a retirar na clínica', etapa('aguardando_entrega').filter((s) => { const e = entrega(s); return e?.modo === 'fisica' && e.estado !== 'retirada_confirmada'; })],
    ],
    // O Administrador NÃO tem fila: ele acompanha, não executa. Dar fila a quem cobra mistura os
    // dois lados — a visão dele é a Visão geral, a lista de solicitações e os relatórios.
    admin: [],
  };
  return (porPapel[papel] || []).map(([titulo, dica, itens]) => ({ titulo, dica, itens }));
}

/**
 * Reparte uma fila entre o que ninguém pegou, o que é do usuário e o que é de outra pessoa.
 * Itens de custódia (prontuários) não têm dono: a trilha do prontuário é controlada pelos
 * registros de movimentação, não por posse de caso, e misturar os dois eixos é o que o sistema
 * evita em todo lugar. Eles ficam sempre como trabalho da equipe.
 */
export function repartir(fila, ator, papel = null) {
  const livres = [], meus = [], assumidos = [], custodia = [];
  for (const it of fila.itens) {
    if (!it.protocolo) { custodia.push(it); continue; }
    if (it.assumido_por === ator) { meus.push(it); continue; }
    // DONO DE OUTRA EQUIPE NÃO FALA PELA SUA.
    //
    // Há etapas em que duas equipes agem (a entrega, por exemplo, que o Call Center define e a
    // Recepção confirma). Quando o Call Center assume o caso, ele continua precisando da
    // Recepção — e, se a posse dele escondesse o caso da fila dela, o trabalho sumiria da vista
    // de quem tem de fazê-lo. Para a SUA equipe, um caso que ninguém da sua equipe pegou está
    // solto, ainda que tenha dono do outro lado.
    const papeisDoDono = it.assumido_por ? (usuarioPor(it.assumido_por)?.papeis || []) : [];
    if (it.assumido_por && (!papel || papeisDoDono.includes(papel))) assumidos.push(it);
    else livres.push(it);
  }
  return { ...fila, livres, meus, assumidos, custodia };
}

/**
 * O CASO MAIS URGENTE DO PAPEL — o que o botão "Próximo caso" abre.
 *
 * Quem atende em série não quer escolher: quer o próximo. Escolher custa ler a fila inteira, e
 * ler a fila inteira várias vezes por hora é como um caso urgente fica para trás enquanto alguém
 * resolve três fáceis. A ordem é a mesma que uma pessoa experiente usaria, nesta sequência:
 *
 *   1. o que já estourou a meta da clínica, depois o que está perto dela;
 *   2. prioridade alta antes de normal, normal antes de baixa;
 *   3. empatou, o que está parado há mais tempo.
 *
 * O que já é de OUTRA pessoa fica de fora: "o próximo" é o próximo que é seu para pegar.
 */
export function proximoCaso(papel, ator, D, metas) {
  const vistos = new Set();
  const lista = [];
  for (const f of filasDoPapel(papel, D)) {
    for (const it of f.itens) {
      if (!it.protocolo || vistos.has(it.id)) continue;
      // Mesma regra da fila: dono de outra equipe não torna o caso "de outra pessoa" para você.
      const dono = it.assumido_por;
      if (dono && dono !== ator && (usuarioPor(dono)?.papeis || []).includes(papel)) continue;
      vistos.add(it.id);
      lista.push(it);
    }
  }
  const peso = (s) => {
    const sit = situacao(s, metas);
    return [
      sit.estado === 'atrasada' ? 0 : sit.estado === 'atencao' ? 1 : 2,
      ['alta', 'normal', 'baixa'].indexOf(s.prioridade || 'normal'),
      new Date(s.etapa_desde).getTime(),
    ];
  };
  return lista.sort((a, b) => {
    const pa = peso(a), pb = peso(b);
    for (let i = 0; i < pa.length; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  })[0] || null;
}

/** Itens distintos de um conjunto de listas — o Set é o que impede a contagem dobrada. */
const distintos = (listas) => new Set(listas.flat().map((it) => it.id)).size;

/**
 * Os dois números do menu, contados EXATAMENTE como as duas telas contam: sem repetir o caso que
 * aparece em mais de uma fila.
 */
export function contarFilas(papel, ator, D) {
  const partes = filasDoPapel(papel, D).map((f) => repartir(f, ator, papel));
  return {
    atual: distintos(partes.map((f) => [...f.livres, ...f.custodia])),
    minha: distintos(partes.map((f) => f.meus)),
  };
}
