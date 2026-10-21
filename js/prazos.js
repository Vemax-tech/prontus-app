// PRONTUS — metas de prazo por etapa e o alerta de pedido parado. Puro, testável, sem DOM.
//
// POR QUE ISTO EXISTE AGORA.
// O plano do projeto pede, já no MVP: "Pedido parado dá alerta. Se um passo passa do tempo
// combinado (por exemplo, 2 horas com o médico), a linha fica vermelha na fila." É também a
// principal defesa contra o maior risco listado lá — a Recepção esquecer de marcar um passo e o
// pedido parecer parado para todo mundo.
//
// Até aqui o sistema mostrava só "tempo parado" e se recusava a dizer "atrasada", porque dizer
// isso sem meta é inventar número. A recusa estava certa; o que faltava era a meta. Agora ela
// existe, fica NA CONFIGURAÇÃO DA CLÍNICA e pode ser mudada por quem administra.
//
// OS VALORES ABAIXO SÃO PROPOSTA, NÃO VERDADE. O plano lista "qual tempo máximo é aceitável em
// cada etapa" como pergunta em aberto, e só a clínica responde. Eles estão aqui para o sistema
// nascer funcionando, e a tela de configuração diz, em letras, que são um ponto de partida.
// O único valor que veio do plano é o das 2 horas com o médico.
import * as F from './fluxo.js';

/** Horas que cada etapa deveria levar. `null` = sem meta: a etapa não gera alerta. */
export const METAS_PADRAO = {
  aberta: 2,
  em_triagem: 2,
  aguardando_prontuario: 4,
  prontuario_em_transito: 2,
  prontuario_na_recepcao: 2,
  aguardando_medico: 2,                 // do plano, seção 6
  aguardando_esclarecimento: 4,
  retorno_disponivel: 2,
  aguardando_contato_paciente: 6,
  aguardando_entrega: 24,
  concluida: null,
  cancelada: null,
};

/** A partir de quanto da meta a etapa entra em "atenção" — avisa antes de estourar. */
export const FRACAO_ATENCAO = 0.75;

export const horasDesde = (iso) => (Date.now() - new Date(iso).getTime()) / 3600e3;

/**
 * Situação de prazo de uma solicitação aberta.
 *
 * Devolve sempre o mesmo formato, para a tela não ter de decidir nada:
 *   { estado: 'sem_meta' | 'ok' | 'atencao' | 'atrasada', meta, horas, excedente, rotulo }
 *
 * `excedente` é quanto passou da meta, em horas — é o que ordena a fila de quem está pior.
 * Caso encerrado não tem prazo: não existe "atrasada" depois de concluída.
 */
export function situacao(sol, metas = METAS_PADRAO) {
  if (!F.aberta(sol)) return { estado: 'sem_meta', meta: null, horas: 0, excedente: 0, rotulo: null };
  const meta = metas?.[sol.etapa] ?? null;
  const horas = horasDesde(sol.etapa_desde);
  if (meta === null || meta === undefined) return { estado: 'sem_meta', meta: null, horas, excedente: 0, rotulo: null };
  if (horas > meta) return { estado: 'atrasada', meta, horas, excedente: horas - meta, rotulo: 'Atrasada' };
  if (horas >= meta * FRACAO_ATENCAO) return { estado: 'atencao', meta, horas, excedente: 0, rotulo: 'Perto do prazo' };
  return { estado: 'ok', meta, horas, excedente: 0, rotulo: null };
}

export const atrasada = (sol, metas) => situacao(sol, metas).estado === 'atrasada';

/** Quanto falta (ou passou) em horas, com sinal: negativo = ainda dentro do prazo. */
export const folga = (sol, metas = METAS_PADRAO) => {
  const s = situacao(sol, metas);
  return s.meta === null ? null : s.horas - s.meta;
};

/** Texto curto para a tela: "2 h de meta, parada há 5 h". Sem meta, só o tempo parado. */
export function explicar(sol, metas = METAS_PADRAO) {
  const s = situacao(sol, metas);
  const h = (n) => (n < 1 ? `${Math.round(n * 60)} min` : n < 48 ? `${Math.round(n)} h` : `${Math.round(n / 24)} d`);
  if (s.estado === 'sem_meta') return s.meta === null && F.aberta(sol) ? `sem meta definida para "${F.ETAPAS[sol.etapa]}"` : null;
  if (s.estado === 'atrasada') return `meta de ${h(s.meta)} para "${F.ETAPAS[sol.etapa]}", parada há ${h(s.horas)}`;
  return `meta de ${h(s.meta)}, parada há ${h(s.horas)}`;
}

/** As atrasadas de uma lista, das piores para as melhores. */
export const atrasadas = (sols, metas = METAS_PADRAO) => sols
  .map((s) => ({ sol: s, sit: situacao(s, metas) }))
  .filter((x) => x.sit.estado === 'atrasada')
  .sort((a, b) => b.sit.excedente - a.sit.excedente);
