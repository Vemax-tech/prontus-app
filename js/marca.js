// PRONTUS — nome e assinatura do produto, num lugar só.
//
// O sistema é vendido como produto próprio, independente de quem o fornece. Por isso o nome
// não está espalhado pelo código: título de página, cabeçalho, rodapé e nome de arquivo exportado
// saem todos daqui. Trocar a marca é editar este arquivo.
//
// `fornecedor` é quem presta o suporte técnico e responde comercialmente — aparece só onde isso
// importa (papel de suporte, rodapé). O produto não depende dele para funcionar.
export const MARCA = {
  produto: 'Prontus',
  descritor: 'Solicitações clínicas',
  tagline: 'Da ligação do paciente à receita na mão, com rastro de cada passo.',
  fornecedor: 'VEMAX',
};

/** Monograma: o dossiê e a trilha que a solicitação percorre dentro dele, de um ponto ao outro. */
export const MONOGRAMA = '<rect x="3" y="3" width="18" height="18" rx="4.5"/>'
  + '<path d="M7 15.4h3.1a2 2 0 0 0 2-2v-3a2 2 0 0 1 2-2H17"/>'
  + '<circle cx="7" cy="15.4" r="1.4" fill="currentColor" stroke="none"/>'
  + '<circle cx="17" cy="8.4" r="1.4" fill="currentColor" stroke="none"/>';
