// PRONTUS — matriz papel × recurso × ação. Puro, testável, sem DOM.
//
// ATENÇÃO — VERSÃO DA DEMONSTRAÇÃO.
// Em produção esta matriz é DADO no banco (tabela de papéis × permissões) e a verificação é uma
// função chamada DENTRO de cada transição, que recusa com o código 42501. O navegador nunca decide
// permissão: ele só evita mostrar botão que não funcionaria. Este arquivo é o espelho fiel do que
// vai para o banco — as mesmas linhas, os mesmos níveis.
//
// SÃO QUATRO PAPÉIS, e eles correspondem a quatro fluxos de trabalho distintos:
//   · Call Center — fala com o paciente: abre o pedido no começo e fecha o contato no fim.
//   · Arquivo     — cuida da pasta física: localiza, retira, entrega, recebe de volta e arquiva.
//   · Recepção    — a ponte com o consultório: recebe o prontuário, leva ao médico e registra o
//                   retorno que ele deu. É o único papel com acesso ao conteúdo clínico.
//   · Admin       — o super usuário: cria e desativa pessoas, define as regras da clínica, tira
//                   relatórios e acompanha tudo. NÃO opera fila e NÃO lê conteúdo clínico.
//
// O MÉDICO NÃO É USUÁRIO DO SISTEMA. Ele continua no fluxo — o caso é levado a ele em papel, com
// o prontuário — mas não entra, não tem fila e não tem senha. Quem registra a decisão dele é a
// Recepção, que já é quem leva e quem traz. Ver js/fluxo.js, etapa "com_medico".

export const PAPEIS = {
  callcenter: 'Call Center',
  arquivo: 'Arquivo',
  recepcao: 'Recepção',
  admin: 'Administrador',
};

/** Uma frase por papel: o que esta pessoa faz no sistema. Usada no cabeçalho das telas. */
export const PAPEL_RESUMO = {
  callcenter: 'Abre o pedido do paciente e fecha o contato no fim.',
  arquivo: 'Localiza, entrega e arquiva o prontuário físico.',
  recepcao: 'Leva o caso ao médico e registra o retorno dele.',
  admin: 'Cria usuários, define as regras da clínica e acompanha tudo.',
};

/** 'E' = editar/registrar · 'V' = ver · 'Vm' = ver mínimo (só os campos necessários à função) · ausente = sem acesso */
const M = {
  paciente_identificacao: { callcenter: 'E', arquivo: 'Vm', recepcao: 'V', admin: 'Vm' },
  paciente_historico: { callcenter: 'V', arquivo: 'Vm', recepcao: 'V', admin: 'Vm' },
  solicitacao_abrir: { callcenter: 'E' },
  solicitacao_ver: { callcenter: 'V', arquivo: 'Vm', recepcao: 'V', admin: 'V' },
  solicitacao_editar: { callcenter: 'E', admin: 'E' },
  prontuario_movimentar: { arquivo: 'E' },
  prontuario_confirmar: { recepcao: 'E' },
  prontuario_conferir: { recepcao: 'E' },
  prontuario_devolver: { recepcao: 'E' },
  prontuario_arquivar: { arquivo: 'E' },
  prontuario_ver: { callcenter: 'V', arquivo: 'V', recepcao: 'V', admin: 'V' },
  // Decisão clínica: quem a TOMA é o médico, em papel, fora do sistema. Quem a REGISTRA é a
  // Recepção, que levou o caso e trouxe a resposta — e assina o registro com o nome e o CRM de
  // quem decidiu (RN-11). Nenhum outro papel registra, e por isso nenhum outro pode inventar
  // uma decisão clínica.
  avaliacao_registrar: { recepcao: 'E' },
  // Conteúdo clínico: só a Recepção lê. O Call Center e a administração NÃO leem (RN-18).
  avaliacao_conteudo: { recepcao: 'V' },
  // Que EXISTE um retorno, todos que precisam acompanhar podem ver.
  avaliacao_existencia: { callcenter: 'V', recepcao: 'V', admin: 'V' },
  documento_emitir: { recepcao: 'E' },
  documento_abrir: { recepcao: 'V' },
  documento_metadados: { callcenter: 'V', recepcao: 'V', admin: 'V' },
  comunicacao_registrar: { callcenter: 'E', arquivo: 'E', recepcao: 'E', admin: 'E' },
  comunicacao_ver: { callcenter: 'V', arquivo: 'V', recepcao: 'V', admin: 'V' },
  entrega_registrar: { callcenter: 'E', recepcao: 'E' },
  entrega_confirmar_fisica: { recepcao: 'E' },
  // Fila é trabalho de equipe. O Admin acompanha pela lista de solicitações e pelos relatórios,
  // não pegando caso: dar fila a quem coordena mistura quem cobra com quem é cobrado.
  tarefa_ver: { callcenter: 'V', arquivo: 'V', recepcao: 'V' },
  tarefa_atribuir: { callcenter: 'E', recepcao: 'E', admin: 'E' },
  dashboard: { callcenter: 'V', arquivo: 'Vm', recepcao: 'V', admin: 'V' },
  relatorios: { callcenter: 'V', recepcao: 'V', admin: 'V' },
  usuarios: { admin: 'E' },
  configuracoes: { admin: 'E' },
  auditoria: { admin: 'V' },
};

const ORDEM = { Vm: 1, V: 2, E: 3 };

/** Nível de acesso de um conjunto de papéis a um recurso: 'E' | 'V' | 'Vm' | null (união dos papéis). */
export function nivel(papeis, recurso) {
  const linha = M[recurso];
  if (!linha) return null;
  let melhor = null;
  for (const p of papeis) {
    const n = linha[p];
    if (n && (!melhor || ORDEM[n] > ORDEM[melhor])) melhor = n;
  }
  return melhor;
}

/** Espelho de can_call(recurso, acao) do banco. acao: 'ver' | 'editar'. */
export function pode(papeis, recurso, acao = 'ver') {
  const n = nivel(papeis, recurso);
  if (!n) return false;
  return acao === 'editar' ? n === 'E' : true;
}

/** Vê o conteúdo completo (não só o mínimo)? Usado para esconder o texto clínico. */
export const podeCompleto = (papeis, recurso) => ['V', 'E'].includes(nivel(papeis, recurso));

/** A matriz inteira, para a tela que mostra as permissões na apresentação. */
export const matriz = () => ({ recursos: Object.keys(M), papeis: Object.keys(PAPEIS), celula: (r, p) => M[r]?.[p] || null });

export const RECURSO_ROTULO = {
  paciente_identificacao: 'Paciente — identificação',
  paciente_historico: 'Paciente — histórico',
  solicitacao_abrir: 'Solicitação — abrir',
  solicitacao_ver: 'Solicitação — ver',
  solicitacao_editar: 'Solicitação — editar, reabrir, cancelar',
  prontuario_movimentar: 'Prontuário — localizar, retirar, entregar',
  prontuario_confirmar: 'Prontuário — confirmar recebimento',
  prontuario_conferir: 'Prontuário — conferir',
  prontuario_devolver: 'Prontuário — devolver',
  prontuario_arquivar: 'Prontuário — receber devolução e arquivar',
  prontuario_ver: 'Prontuário — ver custódia e histórico',
  avaliacao_registrar: 'Retorno do médico — registrar',
  avaliacao_conteudo: 'Retorno do médico — ler o conteúdo clínico',
  avaliacao_existencia: 'Retorno do médico — saber que já voltou',
  documento_emitir: 'Documento — registrar / versionar',
  documento_abrir: 'Documento — abrir o conteúdo',
  documento_metadados: 'Documento — ver metadados',
  comunicacao_registrar: 'Comunicação — registrar',
  comunicacao_ver: 'Comunicação — ver',
  entrega_registrar: 'Entrega — orientar / registrar envio',
  entrega_confirmar_fisica: 'Entrega — confirmar retirada física',
  tarefa_ver: 'Fila de trabalho — ver e assumir',
  tarefa_atribuir: 'Tarefa — atribuir a outra pessoa',
  dashboard: 'Visão geral',
  relatorios: 'Relatórios',
  usuarios: 'Usuários e papéis',
  configuracoes: 'Configurações da clínica',
  auditoria: 'Log de auditoria',
};
