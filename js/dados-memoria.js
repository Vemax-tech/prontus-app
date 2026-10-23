// PRONTUS — camada de dados DA DEMONSTRAÇÃO.
//
// =====================================================================================
//  ESTE É O ÚNICO ARQUIVO QUE A TROCA PARA O BANCO REAL SUBSTITUI.
//
//  Guarda tudo em memória e devolve { data, error } como um cliente de banco de verdade,
//  de propósito: as telas usam o mesmo run() e NÃO precisam mudar quando a origem virar
//  o Postgres. As funções de fluxo abaixo (moverSolicitacao, moverProntuario…) são o
//  espelho das funções que vão existir no banco, com as mesmas validações de estado e
//  de papel.
//
//  Em produção a validação feita aqui é redundante — vale a do servidor. Aqui ela existe
//  para a demonstração se comportar como o sistema real.
//
//  NENHUM DADO REAL DE PACIENTE. Tudo sintético, inventado para a apresentação.
// =====================================================================================
import * as F from './fluxo.js';
import { pode, PAPEIS } from './permissoes.js';
import { METAS_PADRAO, situacao } from './prazos.js';
import { MODELOS_PADRAO } from './mensagens.js';

// Id sequencial, NÃO aleatório, e o contador vive dentro do db: cada tela é uma página própria,
// com recarga completa, e o id impresso numa lista precisa continuar valendo na tela seguinte.
// Guardar o contador junto com os dados é o que impede um id novo de colidir com um já salvo.
const uid = (p) => p + '-' + String(++db.seq).padStart(4, '0');
const agora = () => new Date().toISOString();
const horasAtras = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const ok = (data) => ({ data, error: null });
const erro = (message, code = 'P0001') => ({ data: null, error: { code, message } });
/** Mesmo código que o Postgres usa para recusa por RLS: o mensagemErro() de js/base/validacao.js o traduz. */
const negado = (o) => erro(o || 'Sem permissão para esta ação.', '42501');

export const db = {
  seq: 0,
  empresa: { id: 'emp-1', nome: 'Clínica (demonstração)' },
  // Configuração da clínica. Em produção é uma tabela; aqui mora no mesmo db para ser salva,
  // restaurada e reiniciada junto com o resto da demonstração.
  config: { metas: { ...METAS_PADRAO }, exigirArquivamentoParaConcluir: false, medicos: [], mensagens: { ...MODELOS_PADRAO } },
  usuarios: [], pacientes: [], prontuarios: [], movimentos: [], relatos: {},
  solicitacoes: [], tarefas: [], eventos: [],
  avaliacoes: [], documentos: [], comunicacoes: [], entregas: [], auditoria: [],
  // Avisos DENTRO do sistema — o que substitui o grupo do WhatsApp (ver js/avisos.js).
  avisos: [],
};

// ---------------------------------------------------------------- equipe da demonstração
// Quatro papéis, quatro fluxos de trabalho. Quem cria e desativa estas pessoas é o Administrador,
// na tela de Usuários — a única parte do sistema em que alguém mexe na conta de outra pessoa.
const EQUIPE = [
  { id: 'u-ad1', nome: 'Beatriz Lima', papeis: ['admin'], cargo: 'Coordenação', email: 'beatriz@clinica.exemplo' },
  { id: 'u-cc1', nome: 'Aline Barros', papeis: ['callcenter'], cargo: 'Atendente', email: 'aline@clinica.exemplo' },
  { id: 'u-cc2', nome: 'Rafael Nunes', papeis: ['callcenter'], cargo: 'Atendente', email: 'rafael@clinica.exemplo' },
  { id: 'u-ar1', nome: 'Silvio Prado', papeis: ['arquivo'], cargo: 'Responsável pelo arquivo', email: 'silvio@clinica.exemplo' },
  { id: 'u-re1', nome: 'Carla Menezes', papeis: ['recepcao'], cargo: 'Recepção', email: 'carla@clinica.exemplo' },
  { id: 'u-re2', nome: 'Diego Tavares', papeis: ['recepcao'], cargo: 'Recepção', email: 'diego@clinica.exemplo' },
];

// OS MÉDICOS NÃO SÃO USUÁRIOS. Eles não entram no sistema, não têm fila e não têm senha: o caso
// chega até eles em papel, com o prontuário, como já chega hoje. O que o sistema guarda é a lista
// de quem atende na clínica — mantida pela administração em Configurações — para a Recepção
// escolher a quem levou o caso e assinar o retorno com o nome e o registro certos.
const MEDICOS_PADRAO = [
  { nome: 'Dra. Helena Fontes', registro: 'CRM/SP 000000 (fictício)', especialidade: 'Clínica geral' },
  { nome: 'Dr. Paulo Aragão', registro: 'CRM/SP 000001 (fictício)', especialidade: 'Cardiologia' },
];
export const medicosDaClinica = () => db.config.medicos.map((m) => ({ ...m }));

/** Nome da clínica, para os recados que o sistema escreve. Em produção vem da empresa logada. */
export const nomeDaClinica = () => db.empresa.nome;

export const usuarioPor = (id) => db.usuarios.find((u) => u.id === id);
/**
 * Quem entrou pelo login passa a existir entre os usuários da demonstração, para o nome aparecer
 * nas ações e nas filas. Em produção isto some: a pessoa já é uma linha de `perfis`.
 */
export function registrarUsuarioDaSessao(p) {
  if (!p?.id || usuarioPor(p.id)) return;
  db.usuarios.push({ id: p.id, nome: p.nome, papeis: [p.papel], cargo: p.cargo || '', email: p.email || '', ativo: true });
}
export const nomeDe = (id) => usuarioPor(id)?.nome || '—';
/** Só gente ativa: um usuário desativado não recebe trabalho novo, mas continua no histórico. */
export const equipeDoPapel = (papel) => db.usuarios.filter((u) => u.ativo !== false && u.papeis.includes(papel));

// ---------------------------------------------------------------- pacientes sintéticos
const PACIENTES = [
  ['Antônio Carlos Ferreira', '1952-03-14', '(11) 98100-0001'],
  ['Maria Aparecida Souza', '1961-07-02', '(11) 98100-0002'],
  ['José Roberto Lima', '1948-11-25', '(11) 98100-0003'],
  ['Terezinha Gomes', '1955-01-09', '(11) 98100-0004'],
  ['Sebastião Alves', '1943-06-30', '(11) 98100-0005'],
  ['Conceição Batista', '1967-09-18', '(11) 98100-0006'],
  ['Geraldo Martins', '1950-04-21', '(11) 98100-0007'],
  ['Ivone Rodrigues', '1972-12-05', '(11) 98100-0008'],
  ['Benedito Castro', '1939-08-11', '(11) 98100-0009'],
  ['Neusa Pereira', '1958-02-27', '(11) 98100-0010'],
  ['Osvaldo Siqueira', '1946-10-03', '(11) 98100-0011'],
  ['Lourdes Cardoso', '1963-05-16', '(11) 98100-0012'],
  ['Djalma Teixeira', '1951-12-22', '(11) 98100-0013'],
  ['Marlene Figueiredo', '1969-03-08', '(11) 98100-0014'],
  ['Waldemar Pinto', '1942-07-19', '(11) 98100-0015'],
  ['Zilda Monteiro', '1957-11-30', '(11) 98100-0016'],
  ['Hermínio Dantas', '1944-09-05', '(11) 98100-0017'],
  ['Ruth Vasconcelos', '1954-05-02', '(11) 98100-0018'],
  ['Ariovaldo Nunes', '1947-01-23', '(11) 98100-0019'],
];
// Um paciente tem UM prontuário. Dois atendimentos abertos do mesmo paciente disputariam a mesma
// custódia, o que a própria regra RN-08 proíbe — então só reaproveitamos um paciente quando o
// atendimento anterior dele não tirou o prontuário do arquivo.

// ---------------------------------------------------------------- roteiro dos dois fluxos
// Marcos em ordem. O semeador "reproduz" o fluxo até o marco pedido, então os dados de exemplo
// são necessariamente consistentes com a máquina de estados — não há estado impossível na demo.
const MARCOS = [
  'aberta', 'pedido_arquivo', 'localizado', 'retirado', 'entregue', 'recebido', 'conferido',
  'ao_medico', 'avaliado', 'avisado_grupo', 'conferido_cc', 'contato_paciente', 'entrega', 'concluida',
];

function semearSolicitacao(spec) {
  const pac = db.pacientes[spec.pac];
  const pront = db.prontuarios.find((p) => p.paciente_id === pac.id);
  const ate = MARCOS.indexOf(spec.ate);
  const cc = spec.cc || 'u-cc1';
  let t = spec.horas;                                   // horas atrás em que o caso começou
  const passo = (h = 1) => { t = Math.max(0.2, t - h); return horasAtras(t); };

  const sol = {
    id: uid('sol'), empresa_id: db.empresa.id, protocolo: 1000 + db.solicitacoes.length + 1,
    tipo: spec.tipo, etapa: 'aberta', etapa_desde: horasAtras(t), desfecho: null,
    prioridade: spec.prioridade || 'normal', paciente_id: pac.id, prontuario_id: pront.id,
    aberta_por: cc, responsavel_id: cc,
    assumido_por: null, assumido_em: null,
    criado_em: horasAtras(t), concluida_em: null, reaberturas: 0, motivo: null,
  };
  db.solicitacoes.push(sol);
  db.relatos[sol.id] = spec.relato;
  ev(sol, null, 'aberta', cc, 'Solicitação registrada pelo Call Center.');

  const ir = (etapa, ator, nota) => { const de = sol.etapa; sol.etapa = etapa; sol.etapa_desde = passo(); ev(sol, de, etapa, ator, nota); };
  const mov = (tipo, ator, nota) => {
    db.movimentos.push({ id: uid('mov'), prontuario_id: pront.id, solicitacao_id: sol.id, tipo, ator_id: ator, nota: nota || '', criado_em: passo(0.5) });
    const regra = F.MOV_VALIDOS.find((m) => m.mov === tipo);
    if (regra) { pront.local = regra.para; pront.custodia_usuario_id = ator; }
  };
  const com = (canal, tipo, ator, resultado, texto) => {
    db.comunicacoes.push({ id: uid('com'), solicitacao_id: sol.id, canal, tipo, destinatario: tipo === 'contato_paciente' ? pac.nome : 'Grupo operacional', ator_id: ator, resultado, texto, criado_em: passo(0.4) });
  };

  if (ate >= MARCOS.indexOf('pedido_arquivo')) {
    com('whatsapp_grupo', 'pedido_prontuario', cc, 'registrada', `Protocolo ${sol.protocolo} — localizar o prontuário ${pront.codigo} (${pac.nome}).`);
    ir('aguardando_prontuario', cc, 'Pedido publicado no grupo operacional.');
    tarefa(sol, 'arquivo', 'Localizar e separar o prontuário', ate >= MARCOS.indexOf('entregue') ? 'concluida' : 'pendente');
  }
  if (ate >= MARCOS.indexOf('localizado')) mov('localizado', 'u-ar1', `Encontrado na estante ${pront.local_arquivo}.`);
  if (ate >= MARCOS.indexOf('retirado')) mov('retirado', 'u-ar1');
  if (ate >= MARCOS.indexOf('entregue')) {
    mov('entregue', 'u-ar1', 'Levado à Recepção com o papel do pedido.');
    ir('prontuario_em_transito', 'u-ar1', 'Entrega iniciada. Aguarda confirmação de quem recebe.');
    tarefa(sol, 'recepcao', 'Confirmar o recebimento do prontuário', ate >= MARCOS.indexOf('recebido') ? 'concluida' : 'pendente');
  }
  if (ate >= MARCOS.indexOf('recebido')) { mov('recebido', 'u-re1'); ir('prontuario_na_recepcao', 'u-re1', 'Recepção confirmou o recebimento.'); }
  if (ate >= MARCOS.indexOf('conferido')) mov('conferido', 'u-re1', 'Identificação conferida, sem divergência.');
  if (ate >= MARCOS.indexOf('ao_medico')) {
    const med = db.config.medicos.find((m) => m.nome === spec.medico) || db.config.medicos[0];
    mov('encaminhado_medico', 'u-re1');
    sol.medico_nome = med.nome; sol.medico_registro = med.registro;
    ir('com_medico', 'u-re1', `Caso levado a ${med.nome}, junto com o prontuário.`);
    tarefa(sol, 'recepcao', spec.tipo === 'pedido_receita' ? 'Buscar a receita com o médico e registrar' : 'Buscar a resposta do médico e registrar',
      ate >= MARCOS.indexOf('avaliado') ? 'concluida' : 'pendente');
  }
  if (ate >= MARCOS.indexOf('avaliado')) {
    const desfecho = spec.desfecho || (spec.tipo === 'pedido_receita' ? 'receita_emitida' : 'respondido');
    // A decisão é do médico; o registro é da Recepção, que foi até a sala e voltou com a resposta.
    db.avaliacoes.push({
      id: uid('ava'), solicitacao_id: sol.id, desfecho,
      medico_nome: sol.medico_nome, registro_profissional: sol.medico_registro, registrado_por: 'u-re1',
      criado_em: passo(1.5),
    });
    if (desfecho === 'receita_emitida' || desfecho === 'corrigido') {
      const doc = (versao, estado, substitui_id, sufixo) => db.documentos.push({
        id: uid('doc'), solicitacao_id: sol.id, tipo: 'receita', versao, substitui_id, estado,
        emitido_por: sol.medico_nome, registrado_por: 'u-re1',
        nome: `Receita — protocolo ${sol.protocolo}${sufixo}`, criado_em: passo(0.2),
      });
      const anterior = desfecho === 'corrigido';
      if (anterior) doc(1, 'substituido', null, ' (v1)');
      const v1 = db.documentos.filter((d) => d.solicitacao_id === sol.id)[0];
      doc(anterior ? 2 : 1, 'emitido', v1?.id || null, anterior ? ' (v2, corrigida)' : '');
    }
    mov('devolvido_medico', 'u-re1');
    if (desfecho === 'nao_aprovado') {
      ir('concluida', 'u-re1', 'Médico não aprovou o pedido. Pendência: comunicar o paciente.');
      sol.desfecho = 'nao_aprovada'; sol.concluida_em = sol.etapa_desde;
      tarefa(sol, 'callcenter', 'Comunicar ao paciente que o pedido não foi aprovado', 'pendente', cc);
    } else {
      ir('retorno_disponivel', 'u-re1', `Retorno de ${sol.medico_nome} registrado pela Recepção.`);
      tarefa(sol, 'recepcao', 'Receber o retorno e avisar no grupo', ate >= MARCOS.indexOf('avisado_grupo') ? 'concluida' : 'pendente');
    }
  }
  if (ate >= MARCOS.indexOf('avisado_grupo') && sol.etapa === 'retorno_disponivel') {
    const tipo = spec.tipo === 'pedido_receita' ? 'aviso_receita' : 'aviso_retorno';
    com('whatsapp_grupo', tipo, 'u-re1', 'registrada', `Protocolo ${sol.protocolo} — ${spec.tipo === 'pedido_receita' ? 'receita pronta' : 'retorno do médico disponível'}.`);
    ir('aguardando_contato_paciente', 'u-re1', 'Aviso publicado no grupo, com o protocolo.');
    tarefa(sol, 'callcenter', spec.tipo === 'pedido_receita' ? 'Avisar o paciente que a receita está pronta' : 'Comunicar a resposta ao paciente', ate >= MARCOS.indexOf('contato_paciente') ? 'concluida' : 'pendente', cc);
  }
  if (ate >= MARCOS.indexOf('conferido_cc')) com('whatsapp_grupo', 'conferencia', cc, 'registrada', 'Aviso conferido no grupo.');
  if (ate >= MARCOS.indexOf('contato_paciente')) {
    const res = spec.resultadoContato || 'falou';
    com(spec.canalContato || 'telefone', 'contato_paciente', cc, res, res === 'falou' ? 'Paciente informado e ciente.' : res === 'nao_atendeu' ? 'Ligação não atendida. Tentar novamente.' : 'Recado deixado com familiar.');
  }
  if (ate >= MARCOS.indexOf('entrega') && spec.tipo === 'pedido_receita' && sol.etapa === 'aguardando_contato_paciente') {
    ir('aguardando_entrega', cc, 'Paciente avisado. Entrega a registrar.');
    const modo = spec.modo || 'fisica';
    const ent = { id: uid('ent'), solicitacao_id: sol.id, modo, estado: modo === 'fisica' ? 'orientada' : 'anunciada', historico: [], criado_em: passo(0.3) };
    db.entregas.push(ent);
    const anda = (estado, nota) => { ent.historico.push({ estado, quando: passo(0.3), ator_id: cc, nota }); ent.estado = estado; };
    anda(ent.estado, modo === 'fisica' ? 'Paciente orientado a retirar na clínica.' : 'Informado que será enviada digitalmente.');
    if (spec.entrega === 'tentado') anda('envio_tentado', 'Enviado ao destinatário autorizado. Sem confirmação de recebimento.');
    if (spec.entrega === 'enviado') { anda('envio_tentado', 'Enviado ao destinatário autorizado.'); anda('enviado', 'Recebimento confirmado pelo paciente.'); }
    if (spec.entrega === 'retirada') anda('retirada_confirmada', 'Retirada na recepção, conferida com documento.');
    if (spec.entrega === 'falha') anda('falha', 'Número inválido. Pendência mantida para nova tentativa.');
    tarefa(sol, modo === 'fisica' ? 'recepcao' : 'callcenter', modo === 'fisica' ? 'Confirmar a retirada física da receita' : 'Confirmar o envio digital',
      F.ENTREGA_TERMINAL.includes(ent.estado) ? 'concluida' : 'pendente', cc);
  }
  if (ate >= MARCOS.indexOf('concluida') && F.aberta(sol)) {
    ir('concluida', cc, 'Caso concluído: requisitos cumpridos.');
    sol.desfecho = 'resolvida'; sol.concluida_em = sol.etapa_desde;
  }

  // Trilha PARALELA do prontuário: independente da etapa da solicitação (RF-17).
  if (spec.devolucao && pront.local !== 'arquivo') {
    const etapas = { devolvido: ['devolvido'], recebido: ['devolvido', 'recebido_devolucao'], arquivado: ['devolvido', 'recebido_devolucao', 'arquivado'] };
    for (const m of etapas[spec.devolucao] || []) mov(m, m === 'devolvido' ? 'u-re1' : 'u-ar1', m === 'arquivado' ? `Devolvido à estante ${pront.local_arquivo}.` : '');
  }
  if (pront.local !== 'arquivo') { pront.solicitacao_id = sol.id; }

  // Posse na etapa em que o caso parou. `assumido: false` no roteiro deixa o caso SEM dono, para a
  // apresentação ter as duas visões com conteúdo: a "Fila atual" com o que ninguém pegou e a
  // "Minha fila" com o que já tem nome. Sem isso, uma das duas telas abriria vazia.
  if (F.aberta(sol) && spec.assumido !== false) {
    const papel = F.papeisDaEtapa(sol)[0];
    const dono = papel === 'callcenter' ? cc : equipeDoPapel(papel)[0]?.id;
    if (dono) {
      sol.assumido_por = dono; sol.assumido_em = sol.etapa_desde;
      sincronizarTarefa(sol, dono);
      evNota(sol, dono, 'Caso assumido', `${nomeDe(dono)} assumiu a etapa "${F.ETAPAS[sol.etapa]}".`, sol.etapa_desde);
    }
  }

  // Aviso de chegada na fila, para o sininho nascer com conteúdo. Em uso real ele é criado pela
  // própria transição; aqui o roteiro monta o estado direto, então o aviso é montado junto.
  // O caso já assumido chega LIDO: quem pegou o caso obviamente viu o aviso.
  if (F.aberta(sol)) {
    for (const papel of F.papeisDaEtapa(sol)) {
      db.avisos.push({
        id: uid('avi'), solicitacao_id: sol.id, protocolo: sol.protocolo,
        para_papel: papel, tipo: 'chegou_na_fila', texto: F.proximaAcao(sol).texto,
        criado_em: sol.etapa_desde,
        lido_em: sol.assumido_por ? sol.etapa_desde : null,
        lido_por: sol.assumido_por || null,
      });
    }
  }
  return sol;
}

function ev(sol, de, para, ator, nota) {
  db.eventos.push({ id: uid('ev'), solicitacao_id: sol.id, de_etapa: de, para_etapa: para, ator_id: ator, nota, criado_em: sol.etapa_desde });
}
/**
 * Evento que não é mudança de etapa — quem assumiu, quem liberou. Entra na MESMA linha do tempo,
 * de propósito: é assim que, no fim, dá para ler quem respondeu por cada trecho do caso.
 */
function evNota(sol, ator, titulo, nota, quando = agora()) {
  db.eventos.push({ id: uid('ev'), solicitacao_id: sol.id, de_etapa: null, para_etapa: sol.etapa, titulo, ator_id: ator, nota, criado_em: quando });
}
function tarefa(sol, papel, titulo, estado, responsavel = null) {
  db.tarefas.push({ id: uid('tar'), solicitacao_id: sol.id, papel_responsavel: papel, titulo, estado, responsavel_id: responsavel, criado_em: sol.etapa_desde, concluida_em: estado === 'concluida' ? agora() : null });
}

// ---------------------------------------------------------------- o conjunto da apresentação
// Cobre todas as etapas, os dois fluxos, as duas formas de entrega, o caso não aprovado,
// a correção com versão, a tentativa de envio sem confirmação e as pendências de arquivamento.
const ROTEIRO = [
  { tipo: 'duvida_correcao', ate: 'aberta', pac: 0, horas: 3, assumido: false, relato: 'Paciente diz que a posologia na receita está ilegível e quer confirmar a dose.' },
  { tipo: 'pedido_receita', ate: 'aberta', pac: 1, horas: 2, relato: 'Pede renovação da receita de uso contínuo.' },
  { tipo: 'pedido_receita', ate: 'pedido_arquivo', pac: 2, horas: 3, assumido: false, relato: 'Pede nova receita; acabou a medicação nesta semana.', prioridade: 'alta' },
  { tipo: 'duvida_correcao', ate: 'localizado', pac: 3, horas: 2, relato: 'Nome do medicamento parece trocado em relação ao que toma há dois anos.' },
  { tipo: 'pedido_receita', ate: 'entregue', pac: 4, horas: 10, assumido: false, relato: 'Pede receita para continuar o tratamento.' },
  { tipo: 'duvida_correcao', ate: 'recebido', pac: 5, horas: 8, relato: 'Quer saber se pode tomar os dois remédios no mesmo horário.' },
  { tipo: 'pedido_receita', ate: 'ao_medico', pac: 6, horas: 1, relato: 'Receita vencida; pede emissão de nova via.', medico: 'Dr. Paulo Aragão' },
  { tipo: 'duvida_correcao', ate: 'ao_medico', pac: 7, horas: 48, relato: 'Receita sem a quantidade de dias de uso.', prioridade: 'alta' },
  { tipo: 'duvida_correcao', ate: 'avaliado', pac: 8, horas: 1, relato: 'Dosagem divergente da que foi dita na consulta.', desfecho: 'corrigido', devolucao: 'devolvido' },
  { tipo: 'pedido_receita', ate: 'avisado_grupo', pac: 9, horas: 2, relato: 'Pede receita de uso contínuo para três meses.', devolucao: 'recebido' },
  // Reaproveitam pacientes cujo atendimento em aberto NÃO tirou o prontuário do arquivo (pac 0 e 1):
  // dá histórico ao paciente sem criar disputa de custódia.
  // Mais de 24 h de propósito: é o caso que mantém a janela de duplicidade (RF-04) fora do
  // alcance de um pedido novo do mesmo paciente. Encurtar esta idade quebra esse cenário.
  { tipo: 'pedido_receita', ate: 'contato_paciente', pac: 0, horas: 30, relato: 'Segunda via da receita, perdeu a anterior.', resultadoContato: 'nao_atendeu', devolucao: 'arquivado' },
  { tipo: 'duvida_correcao', ate: 'concluida', pac: 1, horas: 60, relato: 'Dúvida sobre jejum antes de tomar o medicamento.', devolucao: 'arquivado', cc: 'u-cc2' },
  // Daqui para baixo, um paciente por atendimento.
  { tipo: 'pedido_receita', ate: 'entrega', pac: 10, horas: 50, assumido: false, relato: 'Receita de uso contínuo; prefere retirar na clínica.', modo: 'fisica', entrega: 'orientada', devolucao: 'arquivado' },
  { tipo: 'pedido_receita', ate: 'entrega', pac: 11, horas: 8, relato: 'Pede receita e aceita receber por mensagem.', modo: 'digital', entrega: 'tentado', devolucao: 'recebido', cc: 'u-cc2' },
  { tipo: 'pedido_receita', ate: 'concluida', pac: 12, horas: 90, relato: 'Renovação de receita, enviada digitalmente.', modo: 'digital', entrega: 'enviado', devolucao: 'arquivado' },
  { tipo: 'pedido_receita', ate: 'concluida', pac: 13, horas: 110, relato: 'Receita retirada presencialmente pelo filho, autorizado.', modo: 'fisica', entrega: 'retirada', devolucao: 'arquivado', cc: 'u-cc2' },
  { tipo: 'pedido_receita', ate: 'avaliado', pac: 14, horas: 1, relato: 'Pede medicação que não consta no histórico.', desfecho: 'nao_aprovado', devolucao: 'arquivado' },
  { tipo: 'duvida_correcao', ate: 'ao_medico', pac: 15, horas: 72, relato: 'Pergunta se pode substituir por genérico.', prioridade: 'alta', assumido: false },
  // Fluxo 1 esperando o Call Center retornar ao paciente: é o caso em que a conclusão depende
  // de contato efetivo, e nenhuma tentativa frustrada basta (RN-06 + RN-12).
  { tipo: 'duvida_correcao', ate: 'avisado_grupo', pac: 16, horas: 28, assumido: false, relato: 'Quer confirmar se a dose da manhã mudou depois da última consulta.', devolucao: 'recebido' },
  // VÁRIOS PEDIDOS ESPERANDO O ARQUIVO AO MESMO TEMPO. É o cenário real do setor: quem vai à
  // estante vai uma vez e volta com um monte de pastas. Com um pedido só na fila, o trabalho em
  // lote não aparece na tela — e a demonstração mostraria um sistema mais manual do que ele é.
  { tipo: 'pedido_receita', ate: 'pedido_arquivo', pac: 17, horas: 2, assumido: false, relato: 'Pede renovação da receita de pressão; acabou ontem.' },
  { tipo: 'duvida_correcao', ate: 'pedido_arquivo', pac: 18, horas: 5, assumido: false, relato: 'Quer confirmar se a dose mudou depois da internação.' },
];

export function semear() {
  db.seq = 0;
  db.config = {
    metas: { ...METAS_PADRAO },
    exigirArquivamentoParaConcluir: false,
    medicos: MEDICOS_PADRAO.map((m) => ({ ...m })),
    mensagens: { ...MODELOS_PADRAO },
  };
  db.avisos = [];
  db.usuarios = EQUIPE.map((u) => ({ ...u, ativo: true }));
  db.pacientes = PACIENTES.map(([nome, nasc, tel], i) => ({
    id: 'pac-' + (i + 1), empresa_id: db.empresa.id, nome, nascimento: nasc, telefone: tel,
    documento: '', observacao: 'Paciente fictício, criado para a demonstração.',
  }));
  db.prontuarios = db.pacientes.map((p, i) => ({
    id: 'pro-' + (i + 1), empresa_id: db.empresa.id, codigo: 'PR-' + String(2000 + i + 1),
    paciente_id: p.id, local: 'arquivo', custodia_usuario_id: 'u-ar1',
    local_arquivo: String.fromCharCode(65 + (i % 4)) + '-' + (10 + i), solicitacao_id: null,
  }));
  db.movimentos = []; db.solicitacoes = []; db.tarefas = []; db.eventos = []; db.relatos = {};
  db.avaliacoes = []; db.documentos = []; db.comunicacoes = []; db.entregas = []; db.auditoria = [];
  ROTEIRO.forEach(semearSolicitacao);
  return db;
}

// ------------------------------------------------- persistência DA DEMONSTRAÇÃO (só esta aba)
//
// O sistema não é uma página só: cada tela é um HTML próprio e toda navegação é uma recarga
// completa. Sem guardar nada, o módulo ressemearia a cada clique e o atendimento que a Recepção
// acabou de encaminhar voltaria ao estado inicial na tela seguinte — a demonstração não teria
// como mostrar um caso andando.
//
// `sessionStorage`, e não `localStorage`, por três razões: morre ao fechar a aba, não atravessa
// para outra aba e não sobrevive ao fim da apresentação. O armazenamento é melhor esforço: se o
// navegador recusar (aba anônima, política restritiva), cada página simplesmente ressemeia e a
// demonstração continua de pé, só sem memória entre telas.
//
// EM PRODUÇÃO ISTO DESAPARECE junto com o resto deste arquivo. O estado vive no banco e nenhum
// dado clínico encosta no armazenamento do navegador.
const CHAVE_DB = 'prontus_db';
// Suba este número sempre que a FORMA dos dados mudar (campo novo, campo que sumiu). Uma aba
// aberta desde antes da mudança tem o modelo velho guardado, e carregá-lo daria uma tela quebrada
// por um motivo invisível — é mais barato descartar e semear de novo.
const VERSAO_DB = 7;

function salvar() {
  try { sessionStorage.setItem(CHAVE_DB, JSON.stringify({ v: VERSAO_DB, db })); } catch { /* sem storage: vale só esta página */ }
}
function carregar() {
  try {
    const bruto = sessionStorage.getItem(CHAVE_DB);
    if (!bruto) return false;
    const salvo = JSON.parse(bruto);
    if (salvo?.v !== VERSAO_DB || !Array.isArray(salvo.db?.solicitacoes) || typeof salvo.db.seq !== 'number') return false;
    Object.assign(db, salvo.db);
    return true;
  } catch { return false; }
}

if (!carregar()) { semear(); salvar(); }

// ---------------------------------------------------------------- leitura
const TABELAS = { avisos: 'avisos', solicitacoes: 'solicitacoes', pacientes: 'pacientes', prontuarios: 'prontuarios', movimentos: 'movimentos', tarefas: 'tarefas', eventos: 'eventos', avaliacoes: 'avaliacoes', documentos: 'documentos', comunicacoes: 'comunicacoes', entregas: 'entregas', usuarios: 'usuarios', auditoria: 'auditoria' };

/** Espelha `sb.from(tabela).select().match(filtro)`. */
export async function listar(tabela, filtro = {}) {
  const arr = db[TABELAS[tabela]];
  if (!arr) return erro(`Tabela desconhecida: ${tabela}`);
  const rows = arr.filter((r) => Object.entries(filtro).every(([k, v]) => r[k] === v));
  return ok(rows.map((r) => ({ ...r })));
}
export async function obter(tabela, id) {
  const r = db[TABELAS[tabela]]?.find((x) => x.id === id);
  return r ? ok({ ...r }) : erro('Registro não encontrado.', 'PGRST116');
}
export const pacientePor = (id) => db.pacientes.find((p) => p.id === id);
export const prontuarioPor = (id) => db.prontuarios.find((p) => p.id === id);
/**
 * A pasta pelo código impresso na etiqueta. É o que o leitor de código de barras usa: um leitor
 * USB não é um periférico que precise de integração — ele digita o código e aperta Enter, como
 * uma pessoa muito rápida. Toda a "integração" é esta busca.
 */
export const prontuarioPorCodigo = (codigo) => {
  const c = String(codigo || '').trim().toLowerCase();
  return c ? db.prontuarios.find((p) => p.codigo.toLowerCase() === c) : undefined;
};

/**
 * O QUE ESTE PACIENTE JÁ USOU DAS OUTRAS VEZES.
 *
 * Não é adivinhação nem automação de decisão: é o registro anterior dele, oferecido como valor
 * JÁ PREENCHIDO no formulário, que a pessoa confirma ou troca. O médico que o acompanha e a forma
 * como ele sempre recebe a receita são as duas perguntas que a equipe responde igual quase toda
 * vez — e responder de novo o que o sistema já sabe é o trabalho que ele deveria estar poupando.
 */
export function sugestoesDoPaciente(paciente_id) {
  const anteriores = db.solicitacoes
    .filter((s) => s.paciente_id === paciente_id)
    .sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em));
  const comMedico = anteriores.find((s) => s.medico_nome);
  const ids = new Set(anteriores.map((s) => s.id));
  const entrega = [...db.entregas].reverse().find((e) => ids.has(e.solicitacao_id));
  return {
    medico_nome: comMedico?.medico_nome || null,
    medico_registro: comMedico?.medico_registro || null,
    modo_entrega: entrega?.modo || null,
    atendimentos: anteriores.length,
  };
}

/** Tudo o que a tela de detalhe precisa, numa chamada. Vira uma view/RPC no banco. */
export async function dossie(id) {
  const sol = db.solicitacoes.find((s) => s.id === id);
  if (!sol) return erro('Solicitação não encontrada.', 'PGRST116');
  const pront = prontuarioPor(sol.prontuario_id);
  return ok({
    sol: { ...sol },
    paciente: { ...pacientePor(sol.paciente_id) },
    prontuario: pront ? { ...pront } : null,
    movimentos: db.movimentos.filter((m) => m.solicitacao_id === id),
    tarefas: db.tarefas.filter((t) => t.solicitacao_id === id),
    eventos: db.eventos.filter((e) => e.solicitacao_id === id),
    avaliacoes: db.avaliacoes.filter((a) => a.solicitacao_id === id),
    documentos: db.documentos.filter((d) => d.solicitacao_id === id),
    comunicacoes: db.comunicacoes.filter((c) => c.solicitacao_id === id),
    entrega: db.entregas.find((e) => e.solicitacao_id === id) || null,
  });
}

/**
 * O relato do paciente NÃO viaja nas linhas da solicitação (no banco ele mora numa tabela sem
 * privilégio de leitura): quem pode lê, por esta chamada. Espelha a função ler_relato().
 */
export async function lerRelato(id, papeis = []) {
  if (!papeis.some((p) => ['callcenter', 'recepcao'].includes(p))) return negado('O seu papel não lê o relato do paciente.');
  if (!(id in db.relatos)) return erro('Solicitação não encontrada.');
  return ok(db.relatos[id]);
}

/** A demonstração tem os dados na própria memória: nada a carregar nem a atualizar. */
export const modo = 'memoria';
export async function prepararDados() { return ok(true); }
export async function atualizarAvisos() { return ok(true); }

/** RN-18 / item 11: a LEITURA de conteúdo clínico também é auditada, não só a alteração. */
export function auditarLeitura(papeis, recurso, solicitacaoId, atorId) {
  db.auditoria.push({ id: uid('aud'), acao: 'leitura', recurso, solicitacao_id: solicitacaoId, ator_id: atorId, papeis: [...papeis], quando: agora() });
  salvar();
}
// Toda escrita bem-sucedida passa por aqui, então é daqui que a demonstração guarda o estado:
// um ponto só, em vez de um salvar() espalhado por cada função.
const auditarEscrita = (acao, recurso, solicitacaoId, atorId, detalhe) => {
  db.auditoria.push({ id: uid('aud'), acao, recurso, solicitacao_id: solicitacaoId, ator_id: atorId, detalhe, quando: agora() });
  salvar();
};

// ---------------------------------------------------------------- escrita (espelho das RPC)
/** Espelho de uma futura RPC abrir_solicitacao(). */
export async function abrirSolicitacao({ tipo, paciente_id, relato, prioridade = 'normal', papeis, ator }) {
  if (!pode(papeis, 'solicitacao_abrir', 'editar')) return negado('Só o Call Center abre solicitação.');
  if (!F.TIPOS[tipo]) return erro('Tipo de solicitação inválido.');
  const pac = pacientePor(paciente_id);
  if (!pac) return erro('Selecione um paciente.');
  const pront = db.prontuarios.find((p) => p.paciente_id === paciente_id);
  const sol = {
    id: uid('sol'), empresa_id: db.empresa.id, protocolo: 1000 + db.solicitacoes.length + 1,
    tipo, etapa: 'aberta', etapa_desde: agora(), desfecho: null, prioridade,
    paciente_id, prontuario_id: pront?.id || null, aberta_por: ator, responsavel_id: ator,
    // Quem registra a ligação já está com o caso: abrir é a primeira etapa, e ela é de quem abriu.
    assumido_por: ator, assumido_em: agora(),
    criado_em: agora(), concluida_em: null, reaberturas: 0, motivo: null,
  };
  db.solicitacoes.push(sol);
  db.relatos[sol.id] = relato;
  ev(sol, null, 'aberta', ator, 'Solicitação registrada pelo Call Center.');
  tarefa(sol, 'callcenter', 'Pedir o prontuário ao arquivo', 'pendente', ator);
  auditarEscrita('criacao', 'solicitacao', sol.id, ator, `protocolo ${sol.protocolo}`);
  return ok({ ...sol });
}

/** RF-04 / CU-04: duplicidade provável — avisa, NÃO bloqueia. */
export function possivelDuplicidade({ tipo, paciente_id }, janelaHoras = 24) {
  const limite = Date.now() - janelaHoras * 3600e3;
  return db.solicitacoes.filter((s) => s.paciente_id === paciente_id && s.tipo === tipo
    && F.aberta(s) && new Date(s.criado_em).getTime() >= limite).map((s) => ({ ...s }));
}

// ------------------------------------------------------------------------------- avisos
//
// O plano do projeto é explícito: os avisos passam a acontecer DENTRO do sistema, no lugar do
// grupo do WhatsApp, "uma única fonte da verdade, sem mensagens perdidas". Então o aviso não é
// algo que alguém escreve: ele NASCE do próprio fluxo. Quando o caso entra na etapa de outra
// equipe, aquela equipe é avisada — sem ninguém precisar lembrar de avisar.
//
// Isto é diferente de `comunicacoes`, e as duas coisas continuam existindo por motivos opostos:
//   · `comunicacoes` registra o que foi feito FORA do sistema (a ligação para o paciente, o
//     recado no grupo). O sistema não envia nada ali — ele anota o que já aconteceu.
//   · `avisos` é o próprio sistema avisando. Tem destinatário (o papel), tem não-lido, e some
//     quando alguém lê.
//
// EM PRODUÇÃO o aviso ao PACIENTE sai por WhatsApp pela API oficial (fase B do plano oficial);
// o aviso entre EQUIPES continua sendo este, que não depende de nenhum serviço externo.

/** Cria um aviso para um papel. Sem destinatário não há aviso: avisar "todo mundo" é o grupo. */
function avisar(sol, paraPapel, tipo, texto) {
  if (!paraPapel) return;
  db.avisos.push({
    id: uid('avi'), solicitacao_id: sol.id, protocolo: sol.protocolo, etapa: sol.etapa,
    para_papel: paraPapel, tipo, texto, criado_em: agora(), lido_em: null, lido_por: null,
  });
}

/** O caso mudou de mãos: a equipe da vez precisa saber, e quem acabou de agir não. */
function avisarEquipeDaVez(sol, etapaAnterior, ator) {
  if (!F.aberta(sol)) {
    // Encerrar também é notícia para quem ainda tem pendência de prontuário.
    const pront = prontuarioPor(sol.prontuario_id);
    if (F.prontuarioPendente(pront)) {
      avisar(sol, pront.local === 'arquivo' || pront.local === 'em_transito_para_arquivo' ? 'arquivo' : 'recepcao',
        'prontuario_pendente', `Caso ${F.DESFECHOS[sol.desfecho] ? F.DESFECHOS[sol.desfecho].toLowerCase() : 'encerrado'}, mas o prontuário ainda não voltou ao arquivo.`);
    }
    return;
  }
  const antes = F.papeisDaEtapa({ ...sol, etapa: etapaAnterior });
  for (const papel of F.papeisDaEtapa(sol)) {
    if (antes.includes(papel) && usuarioPor(ator)?.papeis.includes(papel)) continue;  // continua com quem já estava
    avisar(sol, papel, 'chegou_na_fila', F.proximaAcao(sol).texto);
  }
}

/**
 * PRAZO ESTOURADO VIRA AVISO, não só linha vermelha.
 *
 * js/prazos.js já sabia dizer "atrasada", e a fila já pintava a linha. Mas pintar só alcança quem
 * está com a tela aberta na fila certa — e o caso que trava é justamente aquele que ninguém está
 * olhando. Faltava o passo seguinte: quando a meta estoura, a equipe da vez é AVISADA; quando
 * passa do dobro, quem avisa é o sistema para a coordenação, porque aí já não é esquecimento de
 * uma pessoa, é um caso sem ninguém.
 *
 * Avisa UMA VEZ por caso, por etapa e por nível. Um alerta que se repete a cada doze segundos
 * deixa de ser alerta em dois dias — passa a ser o barulho que se aprende a ignorar.
 *
 * Em produção isto é uma tarefa agendada no banco, não uma função que a tela chama ao abrir.
 */
export function escalonarAtrasos() {
  const metas = db.config.metas;
  let novos = 0;
  for (const sol of db.solicitacoes.filter(F.aberta)) {
    const sit = situacao(sol, metas);
    if (sit.estado !== 'atrasada') continue;
    const horas = Math.round(sit.horas);
    const alvos = [[F.papeisDaEtapa(sol)[0], 'atraso',
      `Parada em "${F.ETAPAS[sol.etapa]}" há ${horas} h. A meta da clínica é ${sit.meta} h.`]];
    // O dobro da meta é o limite em que o problema deixa de ser da equipe e passa a ser de quem
    // coordena: alguém precisa destravar, e não vai ser quem já não agiu.
    if (sit.horas >= sit.meta * 2) {
      alvos.push(['admin', 'atraso_grave',
        `Parada em "${F.ETAPAS[sol.etapa]}" há ${horas} h — mais que o dobro da meta de ${sit.meta} h.`]);
    }
    for (const [papel, tipo, texto] of alvos) {
      if (!papel) continue;
      if (db.avisos.some((a) => a.solicitacao_id === sol.id && a.tipo === tipo && a.etapa === sol.etapa)) continue;
      avisar(sol, papel, tipo, texto);
      novos += 1;
    }
  }
  if (novos) salvar();
  return novos;
}

/** Avisos ainda não lidos do papel. É o número do sininho. */
export const avisosDoPapel = (papel, { somenteNaoLidos = false } = {}) => db.avisos
  .filter((a) => a.para_papel === papel && (!somenteNaoLidos || !a.lido_em))
  .sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em))
  .map((a) => ({ ...a }));

/** Marca avisos como lidos. Sem id, marca todos os do papel — o "limpar" do sininho. */
export async function marcarAvisosLidos({ ids = null, papel, ator }) {
  const alvo = db.avisos.filter((a) => (ids ? ids.includes(a.id) : a.para_papel === papel) && !a.lido_em);
  alvo.forEach((a) => { a.lido_em = agora(); a.lido_por = ator; });
  salvar();
  return ok(alvo.length);
}

// ------------------------------------------------------------------ quem está com o caso AGORA
//
// Dois níveis, que o sistema não confunde:
//   · a ETAPA diz de qual EQUIPE é a vez (js/fluxo.js, papeisDaEtapa);
//   · `assumido_por` diz QUAL PESSOA daquela equipe respondeu por ela.
//
// Enquanto ninguém assume, o caso fica na "Fila atual" — o trabalho que a equipe ainda não pegou.
// Assumido, sai de lá e entra na "Minha fila" de quem assumiu, que passa a ser o nome a cobrar.
// A posse vale por etapa: quando o caso passa para outra equipe, ela se desfaz sozinha (abaixo, em
// moverSolicitacao) — ninguém continua "dono" de um trecho que não é mais dele. Quem respondeu por
// cada trecho fica na linha do tempo, e é isso que dá o rastro do começo ao fim.

/** A tarefa pendente da etapa segue o dono do caso: as duas visões nunca divergem. */
function sincronizarTarefa(sol, atorOuNulo) {
  const daVez = F.papeisDaEtapa(sol);
  db.tarefas
    .filter((t) => t.solicitacao_id === sol.id && t.estado === 'pendente' && daVez.includes(t.papel_responsavel))
    .forEach((t) => { t.responsavel_id = atorOuNulo; });
}

/** Papéis do usuário que ainda estão na vez nesta etapa. Vazio = não é da vez dele. */
const papeisNaVez = (sol, papeis) => F.papeisDaEtapa(sol).filter((p) => papeis.includes(p));

/**
 * Quem age num caso sem dono, estando na vez, VIRA o dono.
 *
 * Silencioso de propósito: o registro do que a pessoa fez já está sendo gravado na mesma
 * operação, e um segundo evento dizendo "assumiu" encheria a linha do tempo de ruído sem
 * acrescentar fato nenhum. O evento de "assumir" continua existindo para o clique explícito,
 * onde ele significa outra coisa — reservar o caso ANTES de agir.
 */
function assumirSeLivre(sol, ator) {
  if (sol.assumido_por || !F.aberta(sol)) return false;
  if (!papeisNaVez(sol, usuarioPor(ator)?.papeis || []).length) return false;
  sol.assumido_por = ator;
  sol.assumido_em = agora();
  sincronizarTarefa(sol, ator);
  return true;
}

/** Espelho de uma futura RPC assumir_solicitacao(). */
export async function assumirSolicitacao({ id, papeis, ator }) {
  const sol = db.solicitacoes.find((s) => s.id === id);
  if (!sol) return erro('Solicitação não encontrada.', 'PGRST116');
  if (!F.aberta(sol)) return erro('O caso já foi encerrado: não há etapa para assumir.');
  if (!papeisNaVez(sol, papeis).length) return negado(`Nesta etapa a vez é do papel ${F.proximaAcao(sol).papel}.`);
  if (sol.assumido_por === ator) return ok({ ...sol });
  if (sol.assumido_por) return erro(`${nomeDe(sol.assumido_por)} já assumiu este caso. Peça para liberar antes.`);
  sol.assumido_por = ator; sol.assumido_em = agora();
  sincronizarTarefa(sol, ator);
  evNota(sol, ator, 'Caso assumido', `${nomeDe(ator)} assumiu a etapa "${F.ETAPAS[sol.etapa]}".`);
  auditarEscrita('assumir', 'solicitacao', id, ator, F.ETAPAS[sol.etapa]);
  return ok({ ...sol });
}

/** Devolve o caso à fila da equipe. Quem assumiu libera; a coordenação também, para destravar. */
export async function liberarSolicitacao({ id, papeis, ator, motivo }) {
  const sol = db.solicitacoes.find((s) => s.id === id);
  if (!sol) return erro('Solicitação não encontrada.', 'PGRST116');
  if (!sol.assumido_por) return erro('Este caso não está assumido por ninguém.');
  const coordena = pode(papeis, 'solicitacao_editar', 'editar');
  if (sol.assumido_por !== ator && !coordena) return negado('Só quem assumiu o caso pode liberá-lo.');
  const quem = sol.assumido_por;
  sol.assumido_por = null; sol.assumido_em = null;
  sincronizarTarefa(sol, null);
  evNota(sol, ator, 'Caso liberado', quem === ator
    ? `${nomeDe(ator)} devolveu o caso à fila da equipe.${motivo ? ' — ' + motivo : ''}`
    : `${nomeDe(ator)} liberou o caso que estava com ${nomeDe(quem)}.${motivo ? ' — ' + motivo : ''}`);
  auditarEscrita('liberar', 'solicitacao', id, ator, F.ETAPAS[sol.etapa]);
  return ok({ ...sol });
}

/** Espelho de mover_solicitacao(): valida transição, papel, condições e grava o evento. Tudo ou nada. */
export async function moverSolicitacao({ id, transicao, papeis, ator, motivo, nota, medico_nome, medico_registro }) {
  const sol = db.solicitacoes.find((s) => s.id === id);
  if (!sol) return erro('Solicitação não encontrada.', 'PGRST116');
  const t = F.transicoesDe(sol, papeis).find((x) => x.id === transicao && x.de === sol.etapa);
  if (!t) return negado('Essa ação não é permitida para o seu papel nesta etapa.');
  if (t.exigeMotivo && !String(motivo || '').trim()) return erro('Informe o motivo.');
  if (t.exigeConferencia && !db.movimentos.some((m) => m.solicitacao_id === id && m.tipo === 'conferido')) {
    return erro('Registre a conferência do prontuário antes de levar o caso ao médico.');
  }
  // T06: o caso sai do sistema e vai para a mão de alguém. Sem saber de quem, o sistema não
  // conseguiria dizer com quem o caso está nem assinar o retorno quando ele voltar.
  if (t.exigeMedico) {
    const nome = String(medico_nome || '').trim();
    if (!nome) return erro('Informe a qual médico o caso foi levado.');
    sol.medico_nome = nome;
    sol.medico_registro = String(medico_registro || db.config.medicos.find((m) => m.nome === nome)?.registro || '').trim();
  }
  // RN-06: conclusão só com os requisitos do tipo cumpridos.
  if (t.para === 'concluida' && t.desfecho === 'resolvida') {
    const { data: d } = await dossie(id);
    const faltas = F.pendenciasParaConcluir(sol, d);
    // DIVERGÊNCIA CONHECIDA, agora decidida pela clínica em vez de pelo código.
    // O plano do projeto diz: "O pedido só vira Concluído quando o paciente foi avisado E o
    // prontuário está de volta ao arquivo." Este sistema foi desenhado ao contrário — as duas
    // trilhas são independentes, porque na vida real a receita fica pronta enquanto a pasta
    // ainda está voltando, e travar a conclusão por causa do arquivo faz a fila mentir.
    // As duas leituras são defensáveis, então a regra virou configuração: ligada, o sistema
    // segue o plano ao pé da letra; desligada (padrão), avisa e deixa concluir.
    if (db.config.exigirArquivamentoParaConcluir && F.prontuarioPendente(d.prontuario)) {
      faltas.push(`O prontuário ainda está em "${F.LOCAIS[d.prontuario.local]}" e a clínica exige o arquivamento antes de concluir.`);
    }
    if (faltas.length) return erro('Não é possível concluir: ' + faltas[0]);
  }
  // T04 e T05: A ETAPA E A PASTA ANDAM JUNTAS, NUM CLIQUE SÓ.
  //
  // `viaProntuario`, em js/fluxo.js, diz qual registro de custódia este passo representa — e até
  // aqui o campo era só documentação. Na prática dava para marcar "entregue à Recepção" no eixo da
  // solicitação com a pasta ainda constando como estando no arquivo, e os dois eixos passavam a
  // contar histórias diferentes sobre o mesmo caso. Pior: obrigava a mesma pessoa a registrar duas
  // vezes o mesmo gesto, em duas telas.
  //
  // Agora o mesmo clique grava os dois. E, se a custódia não permitir (a pasta nem foi retirada
  // ainda), NADA acontece em nenhum dos dois eixos: a recusa vem antes de a etapa mudar.
  // Quem já registrou a movimentação no painel do prontuário não a registra de novo: o passo
  // GARANTE que a custódia esteja em dia, não insiste em repeti-la.
  const custodiaPendente = t.viaProntuario && sol.prontuario_id
    && !db.movimentos.some((m) => m.solicitacao_id === id && m.tipo === t.viaProntuario);
  if (custodiaPendente) {
    const custodia = await moverProntuario({
      prontuario_id: sol.prontuario_id, mov: t.viaProntuario, papeis, ator, solicitacao_id: id,
      nota: `Registrado junto com o passo "${t.rotulo}".`,
    });
    if (custodia.error) return custodia;
  }
  // AGIR É ASSUMIR.
  //
  // Antes era preciso clicar em "Assumir" antes de agir. Isso acontecia em dois momentos: quando
  // alguém lembrava, e quando alguém cobrava. No resto do tempo o caso andava sem dono, e a
  // pergunta "quem está com isso?" voltava para o grupo do WhatsApp — que é de onde este sistema
  // tenta tirar a operação.
  //
  // A posse é gravada ANTES da transição, com a etapa em que a pessoa de fato trabalhou: é dessa
  // que o histórico precisa. Logo abaixo, se o caso passar para outra equipe, a posse se desfaz
  // sozinha, como sempre se desfez.
  //
  // O botão "Assumir" continua existindo para quem quer reservar o caso ANTES de agir ("eu ligo
  // para este paciente"), que é o único momento em que ele informa algo que o sistema não teria
  // como deduzir sozinho.
  assumirSeLivre(sol, ator);
  const de = sol.etapa;
  sol.etapa = t.para; sol.etapa_desde = agora();
  if (t.desfecho) { sol.desfecho = t.desfecho; sol.concluida_em = agora(); }
  if (t.id === 'T16') { sol.desfecho = null; sol.concluida_em = null; sol.reaberturas += 1; }   // RN-15: histórico preservado
  if (motivo) sol.motivo = motivo;
  // A posse vale por etapa. Se a nova etapa ainda é da equipe de quem assumiu, ele continua com o
  // caso (triagem → pedido de prontuário, por exemplo); se passou para outra equipe, o caso volta
  // para a fila dela sem dono — e o nome de quem respondeu pelo trecho anterior fica no histórico.
  if (sol.assumido_por) {
    const papeisDoDono = usuarioPor(sol.assumido_por)?.papeis || [];
    if (!papeisNaVez(sol, papeisDoDono).length) { sol.assumido_por = null; sol.assumido_em = null; }
  }
  ev(sol, de, t.para, ator, nota || t.rotulo + (motivo ? ` — ${motivo}` : ''));
  db.tarefas.filter((x) => x.solicitacao_id === id && x.estado === 'pendente').forEach((x) => {
    if (F.ETAPAS_FIM.includes(t.para) && t.desfecho !== 'nao_aprovada') { x.estado = 'concluida'; x.concluida_em = agora(); }
  });
  proximaTarefa(sol);
  avisarEquipeDaVez(sol, de, ator);
  auditarEscrita('transicao', 'solicitacao', id, ator, `${de} → ${t.para}`);
  return ok({ ...sol });
}

function proximaTarefa(sol) {
  const prox = F.proximaAcao(sol);
  const papel = prox.papeis[0];
  if (!papel) return;
  const jaTem = db.tarefas.some((t) => t.solicitacao_id === sol.id && t.estado === 'pendente' && t.papel_responsavel === papel);
  // A tarefa nasce com dono quando o caso já tem um: de quem assumiu, ou do médico a quem foi
  // encaminhado. Sem dono, ela fica na fila da equipe à espera de alguém assumir.
  if (!jaTem) tarefa(sol, papel, prox.texto, 'pendente', sol.assumido_por || null);
}

/** Espelho de mover_prontuario(): custódia única, transição válida, papel certo. RN-07, RN-08, RN-09. */
export async function moverProntuario({ prontuario_id, mov, papeis, ator, solicitacao_id, nota }) {
  const pront = prontuarioPor(prontuario_id);
  if (!pront) return erro('Prontuário não encontrado.', 'PGRST116');
  const feitos = db.movimentos.filter((m) => m.solicitacao_id === solicitacao_id).map((m) => m.tipo);
  const regra = F.movimentosDe(pront, papeis, feitos).find((m) => m.mov === mov);
  if (!regra) {
    const existe = F.MOV_VALIDOS.find((m) => m.mov === mov);
    if (existe && !existe.papeis.some((p) => papeis.includes(p))) {
      return negado(`Este registro é do papel ${existe.papeis.map((p) => ({ arquivo: 'Arquivo', recepcao: 'Recepção' }[p] || p)).join(' ou ')}.`);
    }
    return erro('Esse movimento não é possível com o prontuário onde ele está agora.');
  }
  if (regra.exigeAntes && !feitos.includes(regra.exigeAntes)) return erro(`Registre "${F.MOVIMENTOS[regra.exigeAntes]}" antes.`);
  // RN-17: repetir a mesma requisição não cria movimentação duplicada.
  if (feitos.includes(mov) && mov !== 'localizado') return ok({ ...pront, repetido: true });
  // Mexer na pasta de um caso que é da sua vez também é agir nele — e, para o Arquivo, QUASE TODO
  // o trabalho é isto. Exigir um clique em "Assumir" antes de cada movimentação seria pedir o
  // dobro de cliques justamente a quem mais registra.
  const solDoMovimento = solicitacao_id ? db.solicitacoes.find((s) => s.id === solicitacao_id) : null;
  if (solDoMovimento) assumirSeLivre(solDoMovimento, ator);
  db.movimentos.push({ id: uid('mov'), prontuario_id, solicitacao_id: solicitacao_id || null, tipo: mov, ator_id: ator, nota: nota || '', criado_em: agora() });
  pront.local = regra.para; pront.custodia_usuario_id = ator;
  if (mov === 'arquivado') pront.solicitacao_id = null;
  auditarEscrita('movimento', 'prontuario', solicitacao_id, ator, `${F.MOVIMENTOS[mov]} → ${F.LOCAIS[regra.para]}`);
  return ok({ ...pront });
}

export async function registrarComunicacao({ solicitacao_id, canal, tipo, destinatario, resultado, texto, papeis, ator }) {
  if (!pode(papeis, 'comunicacao_registrar', 'editar')) return negado();
  if (!F.CANAIS[canal] || !F.COM_TIPOS[tipo]) return erro('Canal ou tipo inválido.');
  // RN-12: comunicação com o paciente sem resultado não existe.
  if (tipo === 'contato_paciente' && (!resultado || resultado === 'registrada')) return erro('Informe o resultado do contato com o paciente.');
  const c = { id: uid('com'), solicitacao_id, canal, tipo, destinatario: destinatario || '', ator_id: ator, resultado: resultado || 'registrada', texto: texto || '', criado_em: agora() };
  db.comunicacoes.push(c);
  auditarEscrita('comunicacao', 'comunicacao', solicitacao_id, ator, `${F.COM_TIPOS[tipo]} — ${F.RESULTADOS[c.resultado]}`);
  return ok({ ...c });
}

/**
 * RN-11, nova redação: a DECISÃO é do médico, o REGISTRO é da Recepção.
 *
 * O médico não usa o sistema — ele decide no papel, com o prontuário na frente. Quem transcreve é
 * quem foi até a sala e voltou. Para a transcrição não virar uma decisão anônima, o registro é
 * assinado: nome e registro profissional de quem decidiu ficam gravados na avaliação, junto com o
 * id de quem digitou. São duas pessoas na mesma linha, e é assim que a auditoria consegue
 * responder tanto "quem decidiu" quanto "quem registrou".
 */
export async function registrarAvaliacao({ solicitacao_id, desfecho, medico_nome, medico_registro, papeis, ator }) {
  if (!pode(papeis, 'avaliacao_registrar', 'editar')) return negado('Só a Recepção registra o retorno do médico.');
  const sol = db.solicitacoes.find((s) => s.id === solicitacao_id);
  if (!sol) return erro('Solicitação não encontrada.', 'PGRST116');
  if (sol.etapa !== 'com_medico') return erro('A solicitação não está com o médico.');
  const nome = String(medico_nome || sol.medico_nome || '').trim();
  const registro = String(medico_registro || sol.medico_registro || '').trim();
  if (!nome || !registro) return erro('Informe o nome e o registro profissional de quem decidiu.');
  const a = {
    id: uid('ava'), solicitacao_id, desfecho,
    medico_nome: nome, registro_profissional: registro, registrado_por: ator,
    criado_em: agora(),
  };
  db.avaliacoes.push(a);
  if (desfecho === 'receita_emitida' || desfecho === 'corrigido') {
    // RN-15 / RF-23: correção cria NOVA VERSÃO; a anterior continua existindo.
    const anteriores = db.documentos.filter((d) => d.solicitacao_id === solicitacao_id);
    anteriores.forEach((d) => { if (d.estado === 'emitido') d.estado = 'substituido'; });
    const ultima = anteriores[anteriores.length - 1];
    db.documentos.push({
      id: uid('doc'), solicitacao_id, tipo: 'receita', versao: (ultima?.versao || 0) + 1,
      substitui_id: ultima?.id || null, estado: 'emitido', emitido_por: nome, registrado_por: ator,
      nome: `Receita — protocolo ${sol.protocolo}${ultima ? ` (v${(ultima.versao || 0) + 1}, corrigida)` : ''}`, criado_em: agora(),
    });
  }
  auditarEscrita('avaliacao', 'avaliacao_medica', solicitacao_id, ator, `${desfecho} — ${nome}`);
  return ok({ ...a });
}

/** RN-13 e RN-14: estados distintos, e combinação modo × estado validada. */
export async function registrarEntrega({ solicitacao_id, modo, estado, nota, papeis, ator }) {
  if (!pode(papeis, 'entrega_registrar', 'editar') && !pode(papeis, 'entrega_confirmar_fisica', 'editar')) return negado();
  const sol = db.solicitacoes.find((s) => s.id === solicitacao_id);
  if (!sol) return erro('Solicitação não encontrada.', 'PGRST116');
  if (sol.tipo !== 'pedido_receita') return erro('Só um pedido de receita tem entrega de documento.');   // RN-22
  if (estado === 'retirada_confirmada' && modo !== 'fisica') return erro('Retirada confirmada só existe na entrega física.');
  if (['anunciada', 'envio_tentado', 'enviado'].includes(estado) && modo !== 'digital') return erro('Esse estado só existe na entrega digital.');
  if (estado === 'retirada_confirmada' && !pode(papeis, 'entrega_confirmar_fisica', 'editar')) return negado('A confirmação da retirada é registrada pela Recepção.');
  let ent = db.entregas.find((e) => e.solicitacao_id === solicitacao_id);
  if (!ent) { ent = { id: uid('ent'), solicitacao_id, modo, estado: 'nao_aplicavel', historico: [], criado_em: agora() }; db.entregas.push(ent); }
  if (ent.modo !== modo && ent.historico.length) return erro('A entrega já foi registrada no outro modo. Cancele e registre de novo.');
  ent.modo = modo; ent.estado = estado;
  ent.historico.push({ estado, quando: agora(), ator_id: ator, nota: nota || '' });
  auditarEscrita('entrega', 'entrega', solicitacao_id, ator, `${F.ENTREGA_MODOS[modo]} — ${F.ENTREGA_ESTADOS[estado]}`);
  return ok({ ...ent });
}

/** A tarefa é da equipe a quem ela foi dirigida: ninguém dá por feito o trabalho de outro papel. */
export async function concluirTarefa({ id, papeis = [], ator }) {
  const t = db.tarefas.find((x) => x.id === id);
  if (!t) return erro('Tarefa não encontrada.', 'PGRST116');
  if (!papeis.includes(t.papel_responsavel)) {
    return negado(`Esta tarefa é do papel ${PAPEIS[t.papel_responsavel] || t.papel_responsavel}.`);
  }
  if (t.estado === 'concluida') return ok({ ...t });
  t.estado = 'concluida'; t.concluida_em = agora();
  auditarEscrita('tarefa', 'tarefa', t.solicitacao_id, ator, t.titulo);
  return ok({ ...t });
}

/** Volta tudo ao estado inicial — útil para reapresentar sem resíduo da demonstração anterior. */
export async function reiniciar() { semear(); salvar(); return ok(true); }

/** Configuração da clínica. Em produção, uma tabela com RLS: só quem administra escreve. */
export const configAtual = () => ({
  ...db.config,
  metas: { ...db.config.metas },
  mensagens: { ...MODELOS_PADRAO, ...db.config.mensagens },
});

export async function salvarConfig({ metas, exigirArquivamentoParaConcluir, medicos, mensagens, papeis, ator }) {
  if (!pode(papeis, 'configuracoes', 'editar')) return negado('Só a administração da clínica muda a configuração.');
  if (medicos) {
    const limpos = medicos
      .map((m) => ({ nome: String(m.nome || '').trim(), registro: String(m.registro || '').trim(), especialidade: String(m.especialidade || '').trim() }))
      .filter((m) => m.nome || m.registro);
    if (limpos.some((m) => !m.nome || !m.registro)) return erro('Cada médico precisa de nome e registro profissional.');
    const nomes = limpos.map((m) => m.nome.toLowerCase());
    if (new Set(nomes).size !== nomes.length) return erro('Há dois médicos com o mesmo nome na lista.');
    db.config.medicos = limpos;
  }
  if (metas) {
    for (const [etapa, v] of Object.entries(metas)) {
      if (!F.ETAPAS[etapa]) return erro(`Etapa desconhecida: ${etapa}`);
      if (v !== null && (!Number.isFinite(v) || v <= 0 || v > 720)) return erro('A meta de cada etapa deve ficar entre 1 e 720 horas, ou ficar vazia.');
    }
    db.config.metas = { ...db.config.metas, ...metas };
  }
  if (mensagens) {
    const limpos = {};
    for (const [chave, texto] of Object.entries(mensagens)) {
      if (!(chave in MODELOS_PADRAO)) return erro(`Modelo de mensagem desconhecido: ${chave}`);
      const t = String(texto || '').trim();
      if (!t) return erro('Nenhum modelo de mensagem pode ficar vazio. Para voltar ao texto de fábrica, use "Restaurar".');
      if (t.length > 600) return erro('O modelo de mensagem passou de 600 caracteres.');
      limpos[chave] = t;
    }
    db.config.mensagens = { ...db.config.mensagens, ...limpos };
  }
  if (typeof exigirArquivamentoParaConcluir === 'boolean') {
    db.config.exigirArquivamentoParaConcluir = exigirArquivamentoParaConcluir;
  }
  db.auditoria.push({ id: uid('aud'), acao: 'configuracao', recurso: 'configuracoes', solicitacao_id: null, ator_id: ator, detalhe: 'metas de prazo, regra de conclusão e lista de médicos', quando: agora() });
  salvar();
  return ok(configAtual());
}

// ---------------------------------------------------------------- usuários (só o Administrador)
//
// É a razão de o papel de Administrador existir: alguém da clínica precisa poder dar e tirar
// acesso sem abrir chamado com o fornecedor. Três regras moldam esta parte:
//
//  1. UM PAPEL POR PESSOA. O sistema aceitaria vários, mas a clínica não precisa disso agora, e
//     "quem é da vez" fica ambíguo quando a mesma pessoa está em duas filas.
//  2. QUEM TEM HISTÓRICO NÃO É APAGADO, É DESATIVADO. Apagar o id de quem assumiu um caso
//     deixaria a linha do tempo dizendo "—" no lugar de um nome, e um registro de saúde não pode
//     perder a autoria. Só quem nunca agiu some de verdade.
//  3. NINGUÉM FICA SEM ADMINISTRADOR. Tirar o último admin trancaria a clínica para fora da
//     própria administração, então essa operação é recusada.

/** Onde um usuário deixou rastro. Vazio = nunca agiu, então pode ser apagado de verdade. */
function rastroDe(id) {
  const n = (arr, campo) => arr.filter((r) => r[campo] === id).length;
  return n(db.solicitacoes, 'aberta_por') + n(db.solicitacoes, 'assumido_por')
    + n(db.movimentos, 'ator_id') + n(db.eventos, 'ator_id') + n(db.comunicacoes, 'ator_id')
    + n(db.avaliacoes, 'registrado_por') + n(db.tarefas, 'responsavel_id') + n(db.auditoria, 'ator_id');
}

const admins = () => db.usuarios.filter((u) => u.ativo !== false && u.papeis.includes('admin'));

function validarUsuario({ nome, email, papel }, idAtual = null) {
  if (!String(nome || '').trim()) return 'Informe o nome.';
  if (!PAPEIS[papel]) return 'Escolha um papel válido.';
  const e = String(email || '').trim().toLowerCase();
  if (e && db.usuarios.some((u) => u.id !== idAtual && (u.email || '').toLowerCase() === e)) return 'Já existe um usuário com este e-mail.';
  return null;
}

export async function criarUsuario({ nome, email, cargo, papel, papeis, ator }) {
  if (!pode(papeis, 'usuarios', 'editar')) return negado('Só o Administrador cria usuários.');
  const msg = validarUsuario({ nome, email, papel });
  if (msg) return erro(msg);
  const u = {
    id: uid('u'), nome: String(nome).trim(), email: String(email || '').trim(),
    cargo: String(cargo || '').trim() || PAPEIS[papel], papeis: [papel], ativo: true, criado_em: agora(),
  };
  db.usuarios.push(u);
  auditarEscrita('criacao', 'usuario', null, ator, `${u.nome} — ${PAPEIS[papel]}`);
  return ok({ ...u });
}

export async function atualizarUsuario({ id, nome, email, cargo, papel, ativo, papeis, ator }) {
  if (!pode(papeis, 'usuarios', 'editar')) return negado('Só o Administrador edita usuários.');
  const u = usuarioPor(id);
  if (!u) return erro('Usuário não encontrado.', 'PGRST116');
  const novoPapel = papel || u.papeis[0];
  const ficaAtivo = ativo === undefined ? u.ativo !== false : Boolean(ativo);
  const msg = validarUsuario({ nome: nome ?? u.nome, email: email ?? u.email, papel: novoPapel }, id);
  if (msg) return erro(msg);
  const perdeAdmin = u.papeis.includes('admin') && (novoPapel !== 'admin' || !ficaAtivo);
  if (perdeAdmin && admins().length <= 1) return erro('Este é o último administrador ativo. Promova outra pessoa antes.');
  if (id === ator && !ficaAtivo) return erro('Você não pode desativar a própria conta.');
  if (nome !== undefined) u.nome = String(nome).trim();
  if (email !== undefined) u.email = String(email).trim();
  if (cargo !== undefined) u.cargo = String(cargo).trim() || PAPEIS[novoPapel];
  u.papeis = [novoPapel];
  u.ativo = ficaAtivo;
  auditarEscrita('alteracao', 'usuario', null, ator, `${u.nome} — ${PAPEIS[novoPapel]}${ficaAtivo ? '' : ' (desativado)'}`);
  return ok({ ...u });
}

/**
 * Exclui. Quem já agiu no sistema é DESATIVADO em vez de apagado — e a resposta diz qual dos dois
 * aconteceu, para a tela poder ser honesta sobre o que o clique fez.
 */
export async function excluirUsuario({ id, papeis, ator }) {
  if (!pode(papeis, 'usuarios', 'editar')) return negado('Só o Administrador exclui usuários.');
  const u = usuarioPor(id);
  if (!u) return erro('Usuário não encontrado.', 'PGRST116');
  if (id === ator) return erro('Você não pode excluir a própria conta.');
  if (u.papeis.includes('admin') && admins().length <= 1) return erro('Este é o último administrador ativo. Promova outra pessoa antes.');
  const rastro = rastroDe(id);
  if (rastro) {
    u.ativo = false;
    auditarEscrita('desativacao', 'usuario', null, ator, `${u.nome} — ${rastro} registro(s) no histórico`);
    return ok({ removido: false, desativado: true, nome: u.nome, rastro });
  }
  db.usuarios = db.usuarios.filter((x) => x.id !== id);
  auditarEscrita('exclusao', 'usuario', null, ator, u.nome);
  return ok({ removido: true, desativado: false, nome: u.nome, rastro: 0 });
}
