// PRONTUS — modelos de recado e o atalho para o WhatsApp. Puro: sem DOM e sem dados.
//
// O QUE ISTO NÃO FAZ: enviar. O sistema continua sem falar com o WhatsApp — quem publica no grupo
// e quem liga para o paciente é a equipe, como já é hoje. Registrar o que foi feito segue sendo o
// que vale, e é o formulário que grava, não o clique que abre o aplicativo.
//
// O QUE ELE FAZ: escrever o recado. Todo dado que entra na mensagem — protocolo, paciente, código
// da pasta, estante, médico — o sistema já tem. Digitar isso de novo, dezenas de vezes por dia,
// em outro aplicativo, é exatamente o trabalho que o sistema existe para tirar da frente. Então
// ele monta o texto, a pessoa lê e corrige se quiser, e um clique abre o WhatsApp com ele pronto.
//
// OS MODELOS SÃO DA CLÍNICA, não do código: ficam em db.config.mensagens e são editados na tela de
// Configurações, como as metas de prazo e a lista de médicos. Os abaixo são o ponto de partida.
//
// EM PRODUÇÃO, quando entrar a API oficial do WhatsApp (fase B do plano), o modelo não muda — o
// mesmo texto passa a sair por uma chamada em vez de por um clique.

/**
 * Modelos padrão, por tipo de comunicação (as chaves são as de F.COM_TIPOS).
 *
 * Os recados para o GRUPO levam só o protocolo, nunca o nome do paciente: o texto fica gravado no
 * histórico do caso e é lido por todos os papéis (inclusive os que não leem a identificação do
 * paciente). Quem quiser o nome no grupo pode pôr `{paciente}` em Configurações; o padrão não põe.
 */
export const MODELOS_PADRAO = {
  pedido_prontuario: 'Protocolo {protocolo} — localizar o prontuário {prontuario}, estante {estante}. {tipo}.',
  aviso_retorno: 'Protocolo {protocolo} — o retorno de {medico} já está registrado no sistema. Pode ligar para o paciente.',
  aviso_receita: 'Protocolo {protocolo} — receita pronta, emitida por {medico}.',
  contato_paciente: 'Olá, {primeiro_nome}. Aqui é da {clinica}, sobre o seu pedido (protocolo {protocolo}). {assunto}',
};

/** O que cada chave significa — a tela de Configurações mostra esta lista a quem edita. */
export const CAMPOS_MODELO = {
  protocolo: 'número do protocolo',
  paciente: 'nome completo do paciente',
  primeiro_nome: 'só o primeiro nome do paciente',
  prontuario: 'código da pasta física',
  estante: 'onde a pasta fica no arquivo',
  tipo: 'tipo da solicitação',
  medico: 'médico que atendeu o caso',
  clinica: 'nome da clínica',
  assunto: 'a frase da vez (receita pronta, resposta do médico…)',
};

/** Troca {chave} pelo valor. Chave sem valor fica como está: some do texto é pior que aparecer. */
export const montar = (texto, dados = {}) => String(texto || '')
  .replace(/\{(\w+)\}/g, (bruto, chave) => {
    const v = dados[chave];
    return v == null || v === '' ? bruto : String(v);
  });

/**
 * Número no formato que o WhatsApp entende: só dígitos, com o país na frente.
 * Devolve null quando não dá para ter certeza — abrir uma conversa com o número errado é pior
 * que não abrir nenhuma.
 */
export function numeroWhats(telefone, pais = '55') {
  const d = String(telefone || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length >= 12 && d.length <= 13) return d;            // já veio com o país
  if (d.length === 10 || d.length === 11) return pais + d;   // DDD + número
  return null;
}

/**
 * Endereço que abre o WhatsApp com o texto pronto.
 *
 * Sem telefone (o caso do GRUPO da clínica, que não tem endereço público), abre o WhatsApp sem
 * destinatário e com o texto na área de transferência da conversa: a pessoa escolhe o grupo. É o
 * máximo que o WhatsApp permite a quem não é integrado por API, e ainda assim tira a digitação.
 */
export const linkWhatsApp = (texto, telefone) => {
  const n = numeroWhats(telefone);
  return `https://wa.me/${n || ''}?text=${encodeURIComponent(String(texto || ''))}`;
};

/** Primeiro nome, para o recado não começar com três nomes e um sobrenome. */
export const primeiroNome = (nome) => String(nome || '').trim().split(/\s+/)[0] || '';
