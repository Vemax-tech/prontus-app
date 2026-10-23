// PRONTUS — a camada de dados que as telas importam.
//
// Duas implementações com a MESMA forma:
//
//  · js/dados-banco.js   — a de verdade. Lê e grava no Postgres (Supabase); a RLS decide quem lê o
//                          quê e as funções do banco decidem quem escreve. É a padrão.
//  · js/dados-memoria.js — a demonstração: tudo na memória do navegador, com dados fictícios. Só
//                          existe para os testes de tela (tests/telas.mjs), que rodam sem rede e
//                          sem banco, e nunca é carregada no uso normal: `usarMemoria()` a importa
//                          sob demanda, e nada na aplicação a chama.
//
// Este arquivo só encaminha. Trocar de implementação não muda uma linha de tela.
import * as banco from './dados-banco.js';

let impl = banco;

/** Para os testes de tela: passa a usar a camada em memória. */
export async function usarMemoria() { impl = await import('./dados-memoria.js'); }
export const modo = () => impl.modo;

// ---- carregar e atualizar
export const prepararDados = (...a) => impl.prepararDados(...a);
export const atualizarAvisos = (...a) => impl.atualizarAvisos(...a);
export const reiniciar = (...a) => impl.reiniciar(...a);

// ---- leitura
export const listar = (...a) => impl.listar(...a);
export const obter = (...a) => impl.obter(...a);
export const dossie = (...a) => impl.dossie(...a);
export const lerRelato = (...a) => impl.lerRelato(...a);
export const pacientePor = (...a) => impl.pacientePor(...a);
export const prontuarioPor = (...a) => impl.prontuarioPor(...a);
export const prontuarioPorCodigo = (...a) => impl.prontuarioPorCodigo(...a);
export const sugestoesDoPaciente = (...a) => impl.sugestoesDoPaciente(...a);
export const possivelDuplicidade = (...a) => impl.possivelDuplicidade(...a);
export const usuarioPor = (...a) => impl.usuarioPor(...a);
export const nomeDe = (...a) => impl.nomeDe(...a);
export const equipeDoPapel = (...a) => impl.equipeDoPapel(...a);
export const registrarUsuarioDaSessao = (...a) => impl.registrarUsuarioDaSessao(...a);
export const medicosDaClinica = (...a) => impl.medicosDaClinica(...a);
export const nomeDaClinica = (...a) => impl.nomeDaClinica(...a);
export const configAtual = (...a) => impl.configAtual(...a);
export const avisosDoPapel = (...a) => impl.avisosDoPapel(...a);
export const auditarLeitura = (...a) => impl.auditarLeitura(...a);

// ---- escrita
export const abrirSolicitacao = (...a) => impl.abrirSolicitacao(...a);
export const assumirSolicitacao = (...a) => impl.assumirSolicitacao(...a);
export const liberarSolicitacao = (...a) => impl.liberarSolicitacao(...a);
export const moverSolicitacao = (...a) => impl.moverSolicitacao(...a);
export const moverProntuario = (...a) => impl.moverProntuario(...a);
export const registrarComunicacao = (...a) => impl.registrarComunicacao(...a);
export const registrarAvaliacao = (...a) => impl.registrarAvaliacao(...a);
export const registrarEntrega = (...a) => impl.registrarEntrega(...a);
export const concluirTarefa = (...a) => impl.concluirTarefa(...a);
export const marcarAvisosLidos = (...a) => impl.marcarAvisosLidos(...a);
export const salvarConfig = (...a) => impl.salvarConfig(...a);
export const escalonarAtrasos = (...a) => impl.escalonarAtrasos(...a);
