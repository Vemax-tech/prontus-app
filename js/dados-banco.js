// PRONTUS — os dados do atendimento, lidos e gravados no BANCO (Supabase / Postgres).
//
// É a implementação de verdade da camada de dados (js/dados.js escolhe qual usar). A forma é a
// mesma de js/dados-memoria.js — as telas não sabem a diferença —, mas aqui:
//
//  · QUEM LÊ O QUÊ é decidido pela RLS do banco (supabase/migrations/0004). Uma tabela que o papel
//    não lê volta vazia; o Arquivo, por exemplo, recebe zero pacientes. As telas já tratam isso.
//  · QUEM ESCREVE E EM QUE ORDEM é decidido pelas funções do banco (0005). Os argumentos `papeis`
//    e `ator` que as telas ainda passam são IGNORADOS de propósito: quem agiu e com que papel é o
//    token de quem está logado, e o navegador não tem como informar outra coisa.
//  · NADA clínico aqui: a decisão do médico é só desfecho e assinaturas, e o relato do paciente só
//    chega por lerRelato(), que o banco audita.
//
// COMO O CACHE FUNCIONA. Várias partes das telas leem de forma síncrona — pacientePor(), nomeDe(),
// prontuarioPor(). Por isso a camada guarda uma cópia do que muda pouco (pacientes, prontuários,
// equipe, configuração, avisos), carregada em prepararDados() quando a página abre e renovada depois
// de cada gravação. O que muda a toda hora (solicitações, eventos, tarefas…) NÃO é guardado: cada
// listar() vai ao banco, e de passagem renova a cópia da tabela que leu.
//
// LIMITE CONHECIDO: o PostgREST devolve no máximo 1000 linhas por consulta. Uma clínica pequena não
// chega lá; quando chegar, a paginação entra aqui, sem mexer nas telas.
import * as F from './fluxo.js';
import { api } from './auth.js';
import { MODELOS_PADRAO } from './mensagens.js';
import { METAS_PADRAO } from './prazos.js';

export const modo = 'banco';

const ok = (data) => ({ data, error: null });
const erro = (message, code = 'P0001') => ({ data: null, error: { code, message } });

// ---------------------------------------------------------------- HTTP
const falha = ({ status, corpo }) => (status === 0
  ? { code: 'P0001', message: 'Sem conexão com o servidor. Verifique a internet e tente de novo.' }
  : { code: String(corpo?.code || status), message: String(corpo?.message || '') });

async function buscar(caminho) {
  const r = await api('/rest/v1/' + caminho);
  return r.status === 0 || r.status >= 400 ? { data: null, error: falha(r) } : ok(r.corpo);
}
async function chamarFuncao(nome, args = {}) {
  const r = await api('/rest/v1/rpc/' + nome, { metodo: 'POST', corpo: args });
  return r.status === 0 || r.status >= 400 ? { data: null, error: falha(r) } : ok(r.corpo);
}
const eq = (filtro) => Object.entries(filtro).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');

// ---------------------------------------------------------------- cópia do que muda pouco
const cache = {
  pacientes: [], prontuarios: [], equipe: [], avisos: [], solicitacoes: [], entregas: [], sugestoes: {},
  config: { nome: 'Clínica', metas: { ...METAS_PADRAO }, exigirArquivamentoParaConcluir: false, medicos: [], mensagens: {} },
};
const comoUsuario = (e) => ({ id: e.id, nome: e.nome, papeis: [e.papel], cargo: e.cargo || '', email: '', ativo: e.ativo });
const comoConfig = (c) => ({
  nome: c.nome || 'Clínica', metas: { ...METAS_PADRAO, ...(c.metas || {}) },
  exigirArquivamentoParaConcluir: Boolean(c.exigir_arquivamento_para_concluir),
  medicos: Array.isArray(c.medicos) ? c.medicos : [], mensagens: c.mensagens || {},
});

async function carregarTabela(tabela, consulta) {
  const r = await buscar(consulta);
  if (!r.error) cache[tabela] = r.data;
  return r;
}
const carregarAvisos = () => carregarTabela('avisos', 'avisos?select=*&order=criado_em.desc&limit=200');
const carregarProntuarios = () => carregarTabela('prontuarios', 'prontuarios?select=*');

/** Carrega o que as telas leem de forma síncrona. Chamada quando a página abre. */
export async function prepararDados() {
  const [pac, eqp, cfg] = await Promise.all([
    carregarTabela('pacientes', 'pacientes?select=*&order=nome'),
    chamarFuncao('equipe'),
    buscar('config_clinica?select=*&id=eq.1'),
    carregarProntuarios(), carregarAvisos(),
  ]);
  if (!eqp.error) cache.equipe = eqp.data.map(comoUsuario);
  if (!cfg.error && cfg.data?.[0]) cache.config = comoConfig(cfg.data[0]);
  return pac.error && eqp.error ? erro('Não foi possível carregar os dados.') : ok(true);
}
export const atualizarAvisos = async () => { await carregarAvisos(); return ok(true); };

// ---------------------------------------------------------------- leitura síncrona (da cópia)
export const medicosDaClinica = () => cache.config.medicos.map((m) => ({ ...m }));
export const nomeDaClinica = () => cache.config.nome;
export const usuarioPor = (id) => cache.equipe.find((u) => u.id === id);
export const nomeDe = (id) => usuarioPor(id)?.nome || '—';
export const equipeDoPapel = (papel) => cache.equipe.filter((u) => u.ativo && u.papeis.includes(papel));
export const pacientePor = (id) => cache.pacientes.find((p) => p.id === id);
export const prontuarioPor = (id) => cache.prontuarios.find((p) => p.id === id);
export const prontuarioPorCodigo = (codigo) => {
  const c = String(codigo || '').trim().toLowerCase();
  return c ? cache.prontuarios.find((p) => p.codigo.toLowerCase() === c) : undefined;
};
/** A equipe do banco já vem com a pessoa logada: não há o que registrar. */
export const registrarUsuarioDaSessao = () => {};
export const configAtual = () => ({
  ...cache.config, metas: { ...cache.config.metas }, mensagens: { ...MODELOS_PADRAO, ...cache.config.mensagens },
});
export const avisosDoPapel = (papel, { somenteNaoLidos = false } = {}) => cache.avisos
  .filter((a) => a.para_papel === papel && (!somenteNaoLidos || !a.lido_em))
  .sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em))
  .map((a) => ({ ...a }));

/** RF-04: duplicidade provável avisa, não bloqueia. Olha as solicitações que a tela acabou de listar. */
export function possivelDuplicidade({ tipo, paciente_id }, janelaHoras = 24) {
  const limite = Date.now() - janelaHoras * 3600e3;
  return cache.solicitacoes.filter((s) => s.paciente_id === paciente_id && s.tipo === tipo
    && F.aberta(s) && new Date(s.criado_em).getTime() >= limite).map((s) => ({ ...s }));
}

/** O que este paciente usou das outras vezes; preenchido por dossie(), que já foi ao banco. */
export const sugestoesDoPaciente = (paciente_id) => cache.sugestoes[paciente_id]
  || { medico_nome: null, medico_registro: null, modo_entrega: null, atendimentos: 0 };

/** A leitura do relato já é auditada pelo banco (ler_relato); nada a registrar daqui. */
export const auditarLeitura = () => {};

// ---------------------------------------------------------------- leitura
const TABELAS = ['avisos', 'solicitacoes', 'pacientes', 'prontuarios', 'movimentos', 'tarefas', 'eventos', 'avaliacoes',
  'documentos', 'comunicacoes', 'entregas', 'usuarios', 'auditoria'];

/** Espelha `sb.from(tabela).select().match(filtro)`: vai ao banco e renova a cópia da tabela lida. */
export async function listar(tabela, filtro = {}) {
  if (!TABELAS.includes(tabela)) return erro(`Tabela desconhecida: ${tabela}`);
  const semFiltro = !Object.keys(filtro).length;
  if (tabela === 'usuarios') {
    const r = await chamarFuncao('equipe');
    if (r.error) return r;
    cache.equipe = r.data.map(comoUsuario);
    return ok(cache.equipe.filter((u) => Object.entries(filtro).every(([k, v]) => u[k] === v)).map((u) => ({ ...u })));
  }
  if (tabela === 'auditoria') {
    const r = await buscar('auditoria_dados?select=*&order=id.desc&limit=200');
    return r.error ? r : ok(r.data.map((a) => ({ ...a, papeis: a.papel ? [a.papel] : [] })));
  }
  const select = tabela === 'entregas' ? 'select=*,historico:entrega_historico(*)' : 'select=*';
  const r = await buscar(`${tabela}?${[select, eq(filtro)].filter(Boolean).join('&')}`);
  if (r.error) return r;
  if (semFiltro && tabela in cache) cache[tabela] = r.data;
  if (tabela === 'solicitacoes' && semFiltro) cache.solicitacoes = r.data;
  return ok(r.data);
}

export async function obter(tabela, id) {
  if (!TABELAS.includes(tabela) || tabela === 'usuarios' || tabela === 'auditoria') return erro(`Tabela desconhecida: ${tabela}`);
  const r = await buscar(`${tabela}?select=*&id=eq.${encodeURIComponent(id)}`);
  if (r.error) return r;
  return r.data[0] ? ok(r.data[0]) : erro('Registro não encontrado.', 'PGRST116');
}

/** Tudo o que a tela de detalhe precisa. O relato NÃO vem aqui: só por lerRelato(). */
export async function dossie(id) {
  const s = await buscar(`solicitacoes?select=*&id=eq.${encodeURIComponent(id)}`);
  if (s.error) return s;
  const sol = s.data[0];
  if (!sol) return erro('Solicitação não encontrada.', 'PGRST116');
  const por = `solicitacao_id=eq.${encodeURIComponent(id)}`;
  const [pac, pront, mov, tar, eve, ava, doc, com, ent, outras] = await Promise.all([
    buscar(`pacientes?select=*&id=eq.${sol.paciente_id}`),
    sol.prontuario_id ? buscar(`prontuarios?select=*&id=eq.${sol.prontuario_id}`) : ok([]),
    buscar(`movimentos?select=*&${por}&order=criado_em`),
    buscar(`tarefas?select=*&${por}&order=criado_em`),
    buscar(`eventos?select=*&${por}&order=criado_em`),
    buscar(`avaliacoes?select=*&${por}&order=criado_em`),
    buscar(`documentos?select=*&${por}&order=versao`),
    buscar(`comunicacoes?select=*&${por}&order=criado_em`),
    buscar(`entregas?select=*,historico:entrega_historico(*)&${por}`),
    buscar(`solicitacoes?select=id,criado_em,medico_nome,medico_registro&paciente_id=eq.${sol.paciente_id}&order=criado_em.desc`),
  ]);
  const falhou = [pac, pront, mov, tar, eve, ava, doc, com, ent].find((x) => x.error);
  if (falhou) return falhou;

  // Sugestões do paciente (médico de sempre, forma de entrega de sempre), para a tela preencher.
  const anteriores = outras.data || [];
  const comMedico = anteriores.find((x) => x.medico_nome);
  const entregasDele = anteriores.length
    ? await buscar(`entregas?select=modo,criado_em&solicitacao_id=in.(${anteriores.map((x) => x.id).join(',')})&order=criado_em.desc&limit=1`)
    : ok([]);
  cache.sugestoes[sol.paciente_id] = {
    medico_nome: comMedico?.medico_nome || null, medico_registro: comMedico?.medico_registro || null,
    modo_entrega: entregasDele.data?.[0]?.modo || null, atendimentos: anteriores.length,
  };

  const ordenados = (a) => [...a].sort((x, y) => new Date(x.criado_em) - new Date(y.criado_em));
  return ok({
    sol, paciente: pac.data[0] || {}, prontuario: pront.data[0] || null,
    movimentos: mov.data, tarefas: tar.data, eventos: ordenados(eve.data), avaliacoes: ava.data,
    documentos: doc.data, comunicacoes: com.data, entrega: ent.data[0] || null,
  });
}

/** O relato do paciente, pela função que o banco audita. Só Call Center e Recepção recebem. */
export async function lerRelato(id) {
  return chamarFuncao('ler_relato', { p_solicitacao: id });
}

// ---------------------------------------------------------------- escrita (funções do banco)
async function gravar(funcao, args, renovar = carregarProntuarios) {
  const r = await chamarFuncao(funcao, args);
  if (r.error) return r;
  await Promise.all([renovar(), carregarAvisos()]);
  return ok(r.data);
}

export const abrirSolicitacao = ({ tipo, paciente_id, relato, prioridade = 'normal' }) =>
  gravar('abrir_solicitacao', { p_tipo: tipo, p_paciente: paciente_id, p_relato: relato, p_prioridade: prioridade });
export const assumirSolicitacao = ({ id }) => gravar('assumir_solicitacao', { p_id: id });
export const liberarSolicitacao = ({ id, motivo }) => gravar('liberar_solicitacao', { p_id: id, p_motivo: motivo || null });
export const moverSolicitacao = ({ id, transicao, motivo, nota, medico_nome, medico_registro }) =>
  gravar('mover_solicitacao', {
    p_id: id, p_transicao: transicao, p_motivo: motivo || null, p_nota: nota || null,
    p_medico_nome: medico_nome || null, p_medico_registro: medico_registro || null,
  });
export const moverProntuario = ({ prontuario_id, mov, solicitacao_id, nota }) =>
  gravar('mover_prontuario', { p_prontuario: prontuario_id, p_mov: mov, p_solicitacao: solicitacao_id || null, p_nota: nota || null });
export const registrarComunicacao = ({ solicitacao_id, canal, tipo, destinatario, resultado, texto }) =>
  gravar('registrar_comunicacao', {
    p_solicitacao: solicitacao_id, p_canal: canal || 'whatsapp_grupo', p_tipo: tipo,
    p_destinatario: destinatario || '', p_resultado: resultado || 'registrada', p_texto: texto || '',
  });
export const registrarAvaliacao = ({ solicitacao_id, desfecho, medico_nome, medico_registro }) =>
  gravar('registrar_avaliacao', { p_solicitacao: solicitacao_id, p_desfecho: desfecho, p_medico_nome: medico_nome || null, p_medico_registro: medico_registro || null });
export const registrarEntrega = ({ solicitacao_id, modo, estado, nota }) =>
  gravar('registrar_entrega', { p_solicitacao: solicitacao_id, p_modo: modo, p_estado: estado, p_nota: nota || null });
export const concluirTarefa = ({ id }) => gravar('concluir_tarefa', { p_id: id });

export async function marcarAvisosLidos({ ids = null } = {}) {
  const r = await chamarFuncao('marcar_avisos_lidos', { p_ids: ids });
  if (r.error) return r;
  await carregarAvisos();
  return ok(r.data);
}

/** Prazo estourado vira aviso: a função do banco avisa uma vez por caso, etapa e nível. */
export async function escalonarAtrasos() {
  const r = await chamarFuncao('escalonar_atrasos');
  if (r.error) return 0;
  if (r.data) await carregarAvisos();
  return r.data || 0;
}

export async function salvarConfig({ metas, exigirArquivamentoParaConcluir, medicos, mensagens }) {
  const r = await chamarFuncao('salvar_config', {
    p_metas: metas ?? null, p_exigir: typeof exigirArquivamentoParaConcluir === 'boolean' ? exigirArquivamentoParaConcluir : null,
    p_medicos: medicos ?? null, p_mensagens: mensagens ?? null,
  });
  if (r.error) return r;
  cache.config = comoConfig(r.data);
  return ok(configAtual());
}

/** Não existe "reiniciar" no banco de verdade: apagar o atendimento de uma clínica não é um botão. */
export async function reiniciar() { return erro('Os dados reais não podem ser reiniciados por aqui.'); }
