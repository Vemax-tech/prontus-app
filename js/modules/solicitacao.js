// PRONTUS — detalhe da solicitação. A tela mais importante do sistema: mostra em que ponto o caso
// está, QUAL É A PRÓXIMA AÇÃO e de quem ela é, e só oferece o que o papel atual pode fazer.
//
// Layout: a trilha de etapas e o cartão de próxima ação ocupam a largura toda, com os botões da
// ação dentro do próprio cartão — ler o que falta e fazer o que falta no mesmo lugar. Abaixo, duas
// colunas: o caso à esquerda, e à direita a coluna que acompanha a rolagem com o resumo, o
// prontuário e as tarefas. A trilha do prontuário é separada porque é controlada de forma
// independente: a devolução pode acontecer antes ou depois de o atendimento ser concluído.
import * as F from '../fluxo.js';
import {
  dossie, moverSolicitacao, moverProntuario, registrarComunicacao, registrarAvaliacao,
  registrarEntrega, concluirTarefa, auditarLeitura, nomeDe, medicosDaClinica,
  assumirSolicitacao, liberarSolicitacao, configAtual, sugestoesDoPaciente, nomeDaClinica,
} from '../dados.js';
import {
  start, h, run, pageHead, badge, icon, modal, formModal, confirmDlg, copyText,
  fmtDate, qs, desde, corEtapa, nota, recadoPronto, montarMensagem, primeiroNome,
} from '../ui.js';
import { PAPEIS } from '../permissoes.js';

const ROOT = new URL('../../', import.meta.url).href;
const PRIO = { alta: 'Alta', normal: 'Normal', baixa: 'Baixa' };
const quando = (iso) => new Date(iso).toLocaleString('pt-BR');
const painel = (titulo, extra, ...corpo) => h('section', { class: 'panel' },
  h('div', { class: 'ph' }, h('h2', {}, titulo), extra),
  h('div', { class: 'pb' }, corpo));
/** Etapas que a trilha desenha, na ordem, por tipo de fluxo. */
const TRILHA = {
  duvida_correcao: ['aberta', 'aguardando_prontuario', 'prontuario_em_transito', 'prontuario_na_recepcao', 'com_medico', 'retorno_disponivel', 'aguardando_contato_paciente', 'concluida'],
  pedido_receita: ['aberta', 'aguardando_prontuario', 'prontuario_em_transito', 'prontuario_na_recepcao', 'com_medico', 'retorno_disponivel', 'aguardando_contato_paciente', 'aguardando_entrega', 'concluida'],
};

/**
 * Os recados que o sistema escreve sozinho. `modelo` é a chave em db.config.mensagens — o texto é
 * da clínica e se edita em Configurações, não aqui —, e `tipo` é o que vai para o histórico de
 * comunicações do caso.
 */
const RECADOS = {
  pedido_prontuario: {
    modelo: 'pedido_prontuario', tipo: 'pedido_prontuario',
    titulo: 'Pedir o prontuário ao arquivo', submit: 'Registrar o pedido',
    ok: 'Pedido registrado. O arquivo já vê na fila dele.',
  },
  aviso_retorno: {
    modelo: 'aviso_retorno', tipo: 'aviso_retorno',
    titulo: 'Avisar o grupo de que o retorno chegou', submit: 'Registrar o aviso',
    ok: 'Aviso registrado. O Call Center já vê na fila dele.',
  },
  aviso_receita: {
    modelo: 'aviso_receita', tipo: 'aviso_receita',
    titulo: 'Avisar o grupo de que a receita está pronta', submit: 'Registrar o aviso',
    ok: 'Aviso registrado. O Call Center já vê na fila dele.',
  },
};

export const initFicha = () => start('solicitacoes/', 'Solicitação', async (ctx, view) => {
  const id = qs('id');
  let d = null;

  async function recarregar() {
    d = await run(dossie(id));
    if (!d) { view.replaceChildren(h('div', { class: 'empty' }, h('p', {}, 'Solicitação não encontrada.'), h('a', { class: 'btn', href: ROOT + 'solicitacoes/', style: 'margin-top:12px' }, 'Voltar à lista'))); return false; }
    return true;
  }
  if (!(await recarregar())) return;

  const pintar = () => { view.replaceChildren(montar()); };
  const agir = async (p, msg) => { const r = await run(p, msg); if (r) { await recarregar(); pintar(); } return r; };

  /** Tudo o que um modelo de mensagem pode citar, tirado do caso que está aberto. */
  const dadosDoRecado = () => ({
    protocolo: d.sol.protocolo,
    paciente: d.paciente.nome,
    primeiro_nome: primeiroNome(d.paciente.nome),
    prontuario: d.prontuario?.codigo,
    estante: d.prontuario?.local_arquivo,
    tipo: F.TIPOS[d.sol.tipo],
    medico: d.sol.medico_nome,
    clinica: nomeDaClinica(),
  });

  // ---------------------------------------------------------------- ações da solicitação
  function acoesSolicitacao() {
    const trans = F.transicoesDe(d.sol, ctx.papeis);
    const assumir = botaoDePosse();
    if (!trans.length) {
      return h('div', { class: 'acts' }, assumir || h('p', { class: 'small muted' }, F.aberta(d.sol)
        ? `Nenhuma ação sua nesta etapa.`
        : 'Caso encerrado.'));
    }
    return h('div', { class: 'acts' }, assumir, trans.map((t) => h('button', {
      class: 'btn' + (t.id === 'T15' ? ' sm danger' : t.para === 'concluida' ? ' primary' : ''),
      onclick: () => executar(t),
    }, t.rotulo)));
  }

  /**
   * Assumir / liberar, no mesmo bloco das outras ações. Só aparece para quem é da vez: assumir um
   * caso de outra equipe não faria sentido, e o banco recusaria.
   */
  function botaoDePosse() {
    if (!F.aberta(d.sol)) return null;
    const daVez = F.papeisDaEtapa(d.sol).some((p) => ctx.papeis.includes(p));
    if (!daVez) return null;
    if (!d.sol.assumido_por) {
      return h('button', {
        class: 'btn primary',
        onclick: () => agir(assumirSolicitacao({ id, papeis: ctx.papeis, ator: ctx.ator }),
          'Caso assumido. Ele está na sua fila até passar para a próxima equipe.'),
      }, 'Assumir o caso');
    }
    if (d.sol.assumido_por !== ctx.ator) return null;
    return h('button', {
      class: 'btn sm',
      onclick: async () => {
        if (!await confirmDlg('Devolver o caso à fila da equipe? Ele volta a aparecer para qualquer pessoa do seu papel, e fica registrado que você o teve.')) return;
        return agir(liberarSolicitacao({ id, papeis: ctx.papeis, ator: ctx.ator }), 'Caso devolvido à fila da equipe.');
      },
    }, 'Liberar');
  }

  async function executar(t) {
    // T03 e T10: no processo real, estes dois passos são uma mensagem publicada no grupo. O
    // sistema escreve o texto a partir do modelo da clínica — ele já conhece protocolo, paciente,
    // código da pasta, estante e médico —, abre o WhatsApp com ele pronto, e o mesmo formulário
    // grava a comunicação. Um gesto no lugar de três (digitar lá, voltar, registrar aqui).
    if (t.exigeComunicacao) {
      const cfg = RECADOS[t.exigeComunicacao === 'aviso_retorno' && d.sol.tipo === 'pedido_receita'
        ? 'aviso_receita' : t.exigeComunicacao];
      const texto = montarMensagem(configAtual().mensagens[cfg.modelo], dadosDoRecado());
      const v = await pedir({
        title: cfg.titulo,
        submitLabel: cfg.submit,
        fields: [
          { name: 'canal', label: 'Canal usado', type: 'select', value: 'whatsapp_grupo', options: Object.entries(F.CANAIS) },
          { name: 'texto', label: 'Mensagem publicada', type: 'textarea', value: texto, maxlength: 1000, hint: 'O texto saiu do modelo da clínica, em Configurações. Corrija à vontade: o que fica no histórico é o que estiver aqui.' },
        ],
        extras: (form, ler) => recadoPronto(form, () => ler('texto')),
      });
      if (!v) return;
      const c = await run(registrarComunicacao({ solicitacao_id: id, tipo: cfg.tipo, destinatario: 'Grupo operacional', resultado: 'registrada', ...v, papeis: ctx.papeis, ator: ctx.ator }));
      if (!c) return;
      return agir(moverSolicitacao({ id, transicao: t.id, papeis: ctx.papeis, ator: ctx.ator }), cfg.ok);
    }
    // T06: o caso sai do sistema. Antes de sair, o sistema pergunta para onde — sem isso ele não
    // sabe com quem o caso está nem com que assinatura o retorno vai voltar.
    if (t.exigeMedico) return levarAoMedico(t);
    // T07: o retorno do médico é a decisão clínica. Formulário próprio.
    if (t.id === 'T07') return registrarRetorno();
    // T12: paciente avisado -> escolher como a receita chega.
    if (t.id === 'T12') {
      // A forma de entrega vem JÁ ESCOLHIDA quando este paciente já recebeu antes: quem sempre
      // retira na clínica vai retirar de novo, e perguntar o que o sistema já sabe é a pergunta
      // que a equipe responde no automático — e responde errado quando está com pressa.
      const sugerido = sugestoesDoPaciente(d.sol.paciente_id);
      const texto = montarMensagem(configAtual().mensagens.contato_paciente,
        { ...dadosDoRecado(), assunto: 'A sua receita já está pronta aqui na clínica.' });
      const v = await pedir({
        title: 'Como a receita vai chegar ao paciente?',
        submitLabel: 'Registrar',
        fields: [
          { name: 'resultado', label: 'Resultado do contato com o paciente', type: 'select', value: 'falou', options: Object.entries(F.RESULTADOS).filter(([k]) => ['falou', 'nao_atendeu', 'recado', 'numero_invalido'].includes(k)), hint: 'Tentativa sem sucesso não conclui o caso.' },
          { name: 'modo', label: 'Forma de entrega', type: 'select', value: sugerido.modo_entrega || 'fisica', options: Object.entries(F.ENTREGA_MODOS), hint: sugerido.modo_entrega ? `Já vem marcada: foi assim nas outras ${sugerido.atendimentos} vez(es) deste paciente. Troque se for diferente.` : null },
          { name: 'texto', label: 'Mensagem para o paciente', type: 'textarea', value: texto, maxlength: 600, hint: 'Vale para quem avisa por WhatsApp. Se o contato foi por telefone, isto fica como o resumo do que foi dito.' },
        ],
        // O número do paciente o sistema já tem: aqui o WhatsApp abre a conversa CERTA, não uma
        // lista de contatos para procurar.
        extras: (form, ler) => recadoPronto(form, () => ler('texto'), { telefone: d.paciente.telefone }),
      });
      if (!v) return;
      const c = await run(registrarComunicacao({ solicitacao_id: id, canal: 'telefone', tipo: 'contato_paciente', destinatario: d.paciente.nome, resultado: v.resultado, texto: v.texto, papeis: ctx.papeis, ator: ctx.ator }));
      if (!c) return;
      const e = await run(registrarEntrega({ solicitacao_id: id, modo: v.modo, estado: v.modo === 'fisica' ? 'orientada' : 'anunciada', nota: v.modo === 'fisica' ? 'Paciente orientado a retirar na clínica.' : 'Informado que será enviada digitalmente.', papeis: ctx.papeis, ator: ctx.ator }));
      if (!e) return;
      return agir(moverSolicitacao({ id, transicao: t.id, papeis: ctx.papeis, ator: ctx.ator }), 'Registrado.');
    }
    // T11 / T13: conclusão. Se faltar requisito, o servidor recusa — mostramos o porquê antes.
    if (t.para === 'concluida' && t.desfecho === 'resolvida') {
      const faltas = F.pendenciasParaConcluir(d.sol, d);
      if (faltas.length) {
        modal('Ainda não é possível concluir', h('div', {},
          h('p', {}, 'Faltam requisitos obrigatórios deste tipo de solicitação:'),
          h('ul', { class: 'ul-list', style: 'margin:12px 0' }, faltas.map((x) => h('li', {}, x))),
          h('p', { class: 'small muted' }, 'O sistema não conclui um caso com requisito obrigatório pendente. Em produção quem recusa é o banco, não a tela.')),
        (close) => h('div', { class: 'row' }, h('button', { class: 'btn', onclick: close }, 'Entendi')));
        return;
      }
      if (F.prontuarioPendente(d.prontuario)) {
        const segue = await confirmDlg(`O prontuário ainda está em "${F.LOCAIS[d.prontuario.local]}". A devolução é controlada separadamente e a pendência continuará visível na fila do arquivo. Concluir o atendimento?`);
        if (!segue) return;
      }
    }
    if (t.exigeMotivo) {
      const v = await pedir({ title: t.rotulo, submitLabel: t.rotulo, fields: [{ name: 'motivo', label: 'Motivo', type: 'textarea', required: true, maxlength: 500, hint: 'Fica no histórico. Nada é apagado.' }] });
      if (!v) return;
      return agir(moverSolicitacao({ id, transicao: t.id, papeis: ctx.papeis, ator: ctx.ator, motivo: v.motivo }), 'Registrado.');
    }
    return agir(moverSolicitacao({ id, transicao: t.id, papeis: ctx.papeis, ator: ctx.ator }), 'Etapa atualizada.');
  }

  const pedir = (cfg) => new Promise((res) => {
    let enviado = false;
    formModal({ ...cfg, onSubmit: async (v) => { enviado = true; res(v); }, onClose: () => { if (!enviado) res(null); } });
  });

  // ---------------------------------------------------------------- o caso sai e volta do médico
  //
  // Estes dois formulários são as bordas do único trecho do processo que acontece FORA do sistema.
  // O primeiro marca a saída e diz a quem o caso foi; o segundo transcreve o que voltou.

  /** T06: a Recepção leva o caso impresso e o prontuário até a sala. Qual sala? */
  function levarAoMedico(t) {
    const medicos = medicosDaClinica();
    // O médico que acompanha este paciente é o da última vez dele. O sistema sabe disso e já
    // deixa escolhido — continua trocável, e a dica diz de onde veio o palpite, para ninguém
    // confirmar no automático achando que foi o sistema que decidiu.
    const sugerido = sugestoesDoPaciente(d.sol.paciente_id);
    const conhecido = sugerido.medico_nome && medicos.some((m) => m.nome === sugerido.medico_nome)
      ? sugerido.medico_nome : null;
    formModal({
      title: 'Levar o caso ao médico',
      submitLabel: 'Registrar a saída',
      fields: medicos.length
        ? [{
          name: 'medico_nome', label: 'A quem o caso foi levado', type: 'select',
          value: d.sol.medico_nome || conhecido || medicos[0].nome,
          options: medicos.map((m) => [m.nome, `${m.nome} — ${m.especialidade || m.registro}`]),
          hint: conhecido && !d.sol.medico_nome
            ? `Já vem marcado ${conhecido}: foi quem atendeu este paciente da última vez. Troque se hoje for outro.`
            : 'A lista é mantida pela administração em Configurações. O registro profissional vem junto e assina o retorno.',
        }]
        : [
          { name: 'medico_nome', label: 'Nome do médico', required: true, maxlength: 80, value: d.sol.medico_nome || sugerido.medico_nome || '' },
          { name: 'medico_registro', label: 'Registro profissional (CRM)', required: true, maxlength: 40, value: d.sol.medico_registro || sugerido.medico_registro || '', hint: 'A clínica ainda não cadastrou a lista de médicos em Configurações; digite desta vez.' },
        ],
      onSubmit: async (v) => {
        const r = await agir(
          moverSolicitacao({ id, transicao: t.id, papeis: ctx.papeis, ator: ctx.ator, ...v, nota: `Caso levado a ${v.medico_nome}, junto com o prontuário.` }),
          `Caso com ${v.medico_nome}. Ele volta para a sua fila quando você registrar o retorno.`);
        if (!r) return false;
        // A pasta vai junto: é o mesmo gesto. As duas trilhas continuam independentes — o painel do
        // prontuário segue mandando nela —, mas obrigar dois cliques para um gesto só é como a
        // custódia passa a dizer "Na Recepção" com a pasta visivelmente na sala do médico.
        await moverProntuarioJunto('encaminhado_medico', 'recepcao', `Levado a ${v.medico_nome}.`);
      },
    });
  }

  /**
   * T07/T08/T14: a Recepção volta da sala e transcreve. A decisão é do médico — o formulário diz
   * isso em letras —, e o registro sai assinado com o nome e o CRM de quem decidiu, mais o id de
   * quem digitou. Duas pessoas na mesma linha: é o que faz a transcrição ser auditável.
   */
  function registrarRetorno() {
    const receita = d.sol.tipo === 'pedido_receita';
    const opcoes = receita
      ? [['receita_emitida', 'Emitiu a receita'], ['nao_aprovado', 'Não aprovou o pedido'], ['precisa_esclarecimento', 'Pediu mais informação']]
      : [['respondido', 'Respondeu (sem alterar a receita)'], ['corrigido', 'Corrigiu a receita (gera nova versão)'], ['precisa_esclarecimento', 'Pediu mais informação']];
    const medico = d.sol.medico_nome || '';
    formModal({
      title: `Registrar o retorno${medico ? ' de ' + medico : ''}`,
      submitLabel: 'Registrar',
      fields: [
        { name: 'medico_nome', label: 'Quem decidiu', required: true, maxlength: 80, value: medico, hint: 'A decisão é do médico. Este registro é a transcrição dela, e fica assinado com o nome dele e o seu.' },
        { name: 'medico_registro', label: 'Registro profissional (CRM)', required: true, maxlength: 40, value: d.sol.medico_registro || '' },
        { name: 'desfecho', label: 'O que ele decidiu', type: 'select', value: opcoes[0][0], options: opcoes },
        { name: 'conteudo_clinico', label: 'Conteúdo clínico', type: 'textarea', required: true, maxlength: 4000, hint: 'Visível só para a Recepção. Não aparece para o Call Center nem para a administração.' },
        { name: 'resumo_para_paciente', label: 'Resumo para repassar ao paciente', type: 'textarea', maxlength: 600, hint: 'Opcional, mas é o que permite ao Call Center avisar o paciente sem ler o conteúdo clínico.' },
      ],
      onSubmit: async (v) => {
        const a = await run(registrarAvaliacao({ solicitacao_id: id, ...v, papeis: ctx.papeis, ator: ctx.ator }));
        if (!a) return false;
        if (v.desfecho === 'precisa_esclarecimento') {
          await agir(moverSolicitacao({ id, transicao: 'T08', papeis: ctx.papeis, ator: ctx.ator, nota: `${v.medico_nome} pediu esclarecimento.` }), 'Pedido de esclarecimento registrado.');
          return;
        }
        const trans = v.desfecho === 'nao_aprovado' ? 'T14' : 'T07';
        await agir(
          moverSolicitacao({ id, transicao: trans, papeis: ctx.papeis, ator: ctx.ator, nota: v.desfecho === 'nao_aprovado' ? `${v.medico_nome} não aprovou o pedido.` : `Retorno de ${v.medico_nome} registrado.` }),
          'Retorno registrado.');
        // Quem volta da sala volta com a pasta na mão. Mesmo gesto, mesmo clique.
        await moverProntuarioJunto('devolvido_medico', 'com_medico', 'Voltou do consultório junto com a resposta.');
      },
    });
  }

  /**
   * Registra o movimento do prontuário que acompanha a saída e a volta do consultório — e só esses
   * dois. `localEsperado` é a guarda: se a pasta não estiver onde o gesto pressupõe (alguém já
   * registrou antes, ou ela seguiu outro caminho), nada acontece aqui e a trilha dela continua
   * sendo conduzida pelo painel do prontuário, onde há espaço para explicar o que houve.
   */
  async function moverProntuarioJunto(mov, localEsperado, nota) {
    if (d.prontuario?.local !== localEsperado) return;
    const { error } = await moverProntuario({ prontuario_id: d.prontuario.id, mov, papeis: ctx.papeis, ator: ctx.ator, solicitacao_id: id, nota });
    if (error) return;                       // silencioso de propósito: a etapa já andou e vale
    await recarregar();
    pintar();
  }

  // ---------------------------------------------------------------- trilha e próxima ação
  function blocoTrilha() {
    const ordem = TRILHA[d.sol.tipo];
    const atual = ordem.indexOf(d.sol.etapa);
    const feitas = new Set(d.eventos.map((e) => e.para_etapa));
    const cancelada = d.sol.etapa === 'cancelada';
    return h('div', {},
      h('div', { class: 'rail', 'aria-label': 'Etapas do fluxo' }, ordem.map((e, i) => h('span', {
        class: 'st ' + (e === d.sol.etapa ? 'atual' : (feitas.has(e) || (atual > -1 && i < atual)) ? 'feita' : ''),
      }, h('span', {}, F.ETAPAS[e])))),
      h('p', { class: 'railinfo' }, cancelada
        ? 'Caso cancelado — a trilha fica como estava no cancelamento.'
        : `Etapa ${atual + 1} de ${ordem.length} · ${F.ETAPAS[d.sol.etapa]} ${desde(d.sol.etapa_desde)}`));
  }

  function blocoProxima() {
    const p = F.proximaAcao(d.sol);
    const meu = p.papel && (p.papel.includes(PAPEIS[ctx.papeis[0]]) || PAPEIS[ctx.papeis[0]] === p.papel);
    const fim = !F.aberta(d.sol);
    return h('div', { class: 'next' + (fim ? ' done' : '') },
      h('div', {},
        h('p', { class: 'k' }, fim ? 'Caso encerrado' : 'Próxima ação'),
        h('h2', {}, p.texto),
        p.papel && h('p', { class: 'who' }, 'Responsável: ', h('b', {}, p.papel),
          // Quem respondeu "sou eu" vem antes do papel na hora de cobrar: se alguém assumiu, é o
          // nome dessa pessoa que vale, não mais "a equipe tal".
          d.sol.assumido_por
            ? h('span', {}, ' · ', h('b', {}, nomeDe(d.sol.assumido_por)),
              d.sol.assumido_por === ctx.ator ? h('span', { class: 'eu' }, ' — é você') : null)
            : meu ? h('span', { class: 'eu' }, ' — é você') : null),
        !fim && !d.sol.assumido_por && h('p', { class: 'small muted', style: 'margin-top:5px' },
          'Ninguém assumiu este caso ainda: ele está na Fila atual da equipe.'),
        d.sol.etapa === 'com_medico' && h('p', { class: 'small muted', style: 'margin-top:5px' },
          `O caso está fisicamente com ${d.sol.medico_nome || 'o médico'}, fora do sistema. Ele volta quando a Recepção registrar o retorno.`),
        fim && F.prontuarioPendente(d.prontuario) && h('p', { class: 'small', style: 'color:var(--warn);margin-top:5px' },
          'Atendimento encerrado, mas o prontuário ainda não voltou ao arquivo. A pendência segue na fila do arquivo.')),
      acoesSolicitacao());
  }

  // ---------------------------------------------------------------- resumo do caso
  function blocoResumo() {
    const verPac = ctx.podeCompleto('paciente_identificacao') || ctx.pode('paciente_identificacao');
    return painel('Resumo', badge(F.ETAPAS[d.sol.etapa], corEtapa(d.sol.etapa)),
      h('dl', { class: 'dl' },
        h('dt', {}, 'Tipo'), h('dd', {}, F.TIPOS[d.sol.tipo]),
        h('dt', {}, 'Paciente'), h('dd', {}, verPac
          ? h('span', {}, d.paciente.nome, h('div', { class: 'micro muted' }, `nasc. ${fmtDate(d.paciente.nascimento)} · ${d.paciente.telefone}`))
          : h('span', { class: 'small muted' }, 'reduzido para o seu papel')),
        h('dt', {}, 'Prontuário'), h('dd', {}, d.prontuario
          ? h('span', { class: 'mono' }, d.prontuario.codigo, h('div', { class: 'micro muted' }, `estante ${d.prontuario.local_arquivo}`))
          : '—'),
        h('dt', {}, 'Tempo na etapa'), h('dd', {}, desde(d.sol.etapa_desde)),
        h('dt', {}, 'Prioridade'), h('dd', {}, d.sol.prioridade === 'alta' ? badge('Alta', 'crit') : PRIO[d.sol.prioridade]),
        h('dt', {}, 'Aberta por'), h('dd', {}, nomeDe(d.sol.aberta_por), h('div', { class: 'micro muted' }, quando(d.sol.criado_em))),
        F.aberta(d.sol) && [h('dt', {}, 'Com quem está'), h('dd', {}, d.sol.assumido_por
          ? h('span', {}, nomeDe(d.sol.assumido_por), h('div', { class: 'micro muted' }, 'assumiu ' + desde(d.sol.assumido_em)))
          : h('span', { class: 'small muted' }, 'ninguém ainda'))],
        d.sol.medico_nome && [h('dt', {}, 'Médico'), h('dd', {}, d.sol.medico_nome,
          d.sol.medico_registro ? h('div', { class: 'micro muted' }, d.sol.medico_registro) : null,
          h('div', { class: 'micro muted' }, 'não é usuário do sistema'))],
        d.sol.desfecho && [h('dt', {}, 'Desfecho'), h('dd', {}, F.DESFECHOS[d.sol.desfecho], d.sol.reaberturas ? h('div', { class: 'micro muted' }, `${d.sol.reaberturas} reabertura(s)`) : null)],
        d.sol.motivo && [h('dt', {}, 'Motivo'), h('dd', {}, d.sol.motivo)]),
      h('p', { class: 'eyebrow', style: 'margin-top:14px' }, 'Relato do paciente'),
      h('p', { class: 'small', style: 'white-space:pre-wrap;margin-top:4px' }, d.sol.relato));
  }

  // ---------------------------------------------------------------- prontuário (eixo paralelo)
  function blocoProntuario() {
    if (!d.prontuario || !ctx.pode('prontuario_ver')) return null;
    const feitos = d.movimentos.map((m) => m.tipo);
    const possiveis = F.movimentosDe(d.prontuario, ctx.papeis, feitos);
    return painel('Prontuário físico',
      badge(F.LOCAIS[d.prontuario.local], d.prontuario.local === 'arquivo' ? 'ok' : d.prontuario.local === 'nao_localizado' ? 'crit' : 'warn'),
      h('dl', { class: 'dl' },
        h('dt', {}, 'Código'), h('dd', { class: 'mono' }, d.prontuario.codigo),
        h('dt', {}, 'Com quem está'), h('dd', {}, nomeDe(d.prontuario.custodia_usuario_id)),
        h('dt', {}, 'Local no arquivo'), h('dd', {}, 'estante ' + d.prontuario.local_arquivo)),
      possiveis.length
        ? h('div', { class: 'row', style: 'margin:12px 0' }, possiveis.map((m) => h('button', {
          class: 'btn sm' + (m.mov === 'nao_localizado' ? ' danger' : ''),
          onclick: () => registrarMov(m),
        }, m.rotulo)))
        : h('p', { class: 'small muted', style: 'margin:12px 0' }, `Nenhum registro de prontuário é do seu papel agora. O próximo é do ${proximoDonoProntuario()}.`),
      nota('', 'Controlado de forma independente do contato com o paciente: devolução e arquivamento podem acontecer antes ou depois de o caso ser concluído.'),
      d.movimentos.length
        ? h('ul', { class: 'tl', style: 'margin-top:12px' }, [...d.movimentos].reverse().map((m) => h('li', {},
          h('div', { class: 'row between' }, h('b', {}, F.MOVIMENTOS[m.tipo]), h('span', { class: 'when' }, quando(m.criado_em))),
          h('p', { class: 'micro muted' }, nomeDe(m.ator_id), m.nota ? ' · ' + m.nota : ''))))
        : h('p', { class: 'small muted', style: 'margin-top:12px' }, 'Nenhuma movimentação ainda.'));
  }

  function proximoDonoProntuario() {
    const todos = F.MOV_VALIDOS.filter((m) => m.de.includes(d.prontuario.local));
    const papel = todos[0]?.papeis[0];
    return PAPEIS[papel] || 'responsável';
  }

  async function registrarMov(m) {
    let obs = '';
    if (['localizado', 'arquivado', 'nao_localizado'].includes(m.mov)) {
      const v = await pedir({
        title: m.rotulo,
        submitLabel: 'Registrar',
        fields: [{ name: 'nota', label: m.mov === 'nao_localizado' ? 'O que aconteceu?' : 'Observação (onde está / para onde foi)', type: 'textarea', maxlength: 300, required: m.mov === 'nao_localizado', value: m.mov === 'arquivado' ? `Devolvido à estante ${d.prontuario.local_arquivo}.` : '' }],
      });
      if (!v) return;
      obs = v.nota;
    }
    const r = await agir(moverProntuario({ prontuario_id: d.prontuario.id, mov: m.mov, papeis: ctx.papeis, ator: ctx.ator, solicitacao_id: id, nota: obs }), 'Movimentação registrada.');
    // A entrega e a confirmação também movem a etapa da solicitação.
    if (r && m.mov === 'entregue') await agir(moverSolicitacao({ id, transicao: 'T04', papeis: ctx.papeis, ator: ctx.ator, nota: 'Prontuário entregue à Recepção. Aguarda confirmação.' }));
    if (r && m.mov === 'recebido') await agir(moverSolicitacao({ id, transicao: 'T05', papeis: ctx.papeis, ator: ctx.ator, nota: 'Recepção confirmou o recebimento.' }));
  }

  // ---------------------------------------------------------------- avaliação, documentos, entrega
  function blocoClinico() {
    if (!d.avaliacoes.length) {
      return ctx.pode('avaliacao_existencia')
        ? painel('Retorno do médico', badge('ainda não registrado', 'dim'),
          h('p', { class: 'small muted' }, d.sol.etapa === 'com_medico'
            ? `O caso está com ${d.sol.medico_nome || 'o médico'}. A Recepção registra o retorno quando ele decidir.`
            : 'Nada registrado ainda para este caso.'))
        : null;
    }
    const completo = ctx.podeCompleto('avaliacao_conteudo');
    const minimo = ctx.pode('avaliacao_conteudo');
    if (completo || minimo) auditarLeitura(ctx.papeis, 'avaliacao_medica', id, ctx.ator);
    const rotulo = {
      respondido: 'Respondido', corrigido: 'Receita corrigida', receita_emitida: 'Receita emitida',
      nao_aprovado: 'Não aprovado', precisa_esclarecimento: 'Precisa de esclarecimento',
    };
    return painel('Retorno do médico', completo ? badge('conteúdo clínico visível', 'info') : badge('conteúdo restrito', 'dim'),
      d.avaliacoes.map((a, i) => h('div', { style: i ? 'margin-top:14px;padding-top:14px;border-top:1px solid var(--line)' : '' },
        h('div', { class: 'row between' },
          badge(rotulo[a.desfecho] || a.desfecho, a.desfecho === 'nao_aprovado' ? 'crit' : 'ok'),
          h('span', { class: 'when' }, quando(a.criado_em))),
        h('p', { class: 'micro muted', style: 'margin:5px 0 8px' },
          'Decidido por ', h('b', {}, a.medico_nome || '—'), ' · ', a.registro_profissional,
          a.registrado_por ? h('span', {}, ' · transcrito por ', nomeDe(a.registrado_por)) : null),
        completo
          ? h('p', { style: 'white-space:pre-wrap' }, a.conteudo_clinico)
          : minimo
            ? h('div', {},
              a.resumo_para_paciente ? h('p', { style: 'white-space:pre-wrap' }, a.resumo_para_paciente) : null,
              nota('', 'O conteúdo clínico completo não é visível para o seu papel. Você vê o resumo autorizado.'))
            : nota('', 'O conteúdo clínico não é visível para o Call Center. Para repassar a resposta por telefone, a saída é o "resumo para o paciente" que a Recepção escreve junto do registro, separado do conteúdo clínico.'))));
  }

  function blocoDocumentos() {
    if (!d.documentos.length || !ctx.pode('documento_metadados')) return null;
    const podeAbrir = ctx.pode('documento_abrir');
    return painel('Documentos', h('span', { class: 'micro muted' }, `${d.documentos.length} versão(ões)`),
      h('ul', { class: 'ul-list' }, d.documentos.map((doc) => h('li', { class: 'row between' },
        h('span', {}, h('b', {}, doc.nome), h('div', { class: 'micro muted' },
          `versão ${doc.versao} · emitida por ${doc.emitido_por || '—'}`
          + (doc.registrado_por ? ` · registrada por ${nomeDe(doc.registrado_por)}` : '')
          + ` · ${quando(doc.criado_em)}`)),
        h('span', { class: 'row' },
          badge(F.DOC_ESTADOS[doc.estado], doc.estado === 'emitido' ? 'ok' : 'dim'),
          podeAbrir
            ? h('button', { class: 'btn sm', onclick: () => abrirDoc(doc) }, 'Abrir')
            : h('span', { class: 'micro muted' }, 'sem permissão'))))),
      nota('', 'Correção nunca sobrescreve: cada versão coexiste e a anterior fica marcada como substituída.'));
  }

  function abrirDoc(doc) {
    auditarLeitura(ctx.papeis, 'documento', id, ctx.ator);
    modal(doc.nome, h('div', {},
      h('p', {}, 'Na demonstração não há arquivo real — nenhum documento clínico de verdade existe aqui.'),
      h('p', { class: 'small muted', style: 'margin-top:10px' }, 'Em produção: o arquivo fica em armazenamento ', h('b', {}, 'privado'), ' e a abertura passa por uma função do banco que (1) confere a permissão, (2) emite um endereço assinado de curta duração e (3) grava a leitura na auditoria. O endereço nunca vai para log nem para o histórico do navegador.'),
      h('p', { class: 'small muted', style: 'margin-top:10px' }, 'Esta abertura acabou de ser registrada na auditoria, com o seu papel e o horário.')),
    (close) => h('div', { class: 'row' }, h('button', { class: 'btn', onclick: close }, 'Fechar')));
  }

  function blocoEntrega() {
    if (d.sol.tipo !== 'pedido_receita') return null;
    const e = d.entrega;
    const podeReg = ctx.pode('entrega_registrar', 'editar') || ctx.pode('entrega_confirmar_fisica', 'editar');
    const opcoes = () => {
      if (!e) return [];
      if (e.modo === 'fisica') return [['retirada_confirmada', 'Confirmar a retirada física']].filter(() => ctx.pode('entrega_confirmar_fisica', 'editar'));
      return [['envio_tentado', 'Registrar tentativa de envio'], ['enviado', 'Confirmar que foi recebido'], ['falha', 'Registrar falha no envio']];
    };
    return painel('Entrega da receita',
      e ? badge(F.ENTREGA_ESTADOS[e.estado], F.ENTREGA_TERMINAL.includes(e.estado) ? 'ok' : e.estado === 'falha' ? 'crit' : 'warn') : badge('não registrada', 'dim'),
      nota('', 'Envio, entrega e leitura são estados diferentes. Tentativa de envio não conclui o caso.'),
      e ? h('div', { style: 'margin-top:12px' },
        h('p', { class: 'small' }, 'Forma: ', h('b', {}, F.ENTREGA_MODOS[e.modo])),
        h('ul', { class: 'tl', style: 'margin-top:12px' }, [...e.historico].reverse().map((x) => h('li', {},
          h('div', { class: 'row between' }, h('b', {}, F.ENTREGA_ESTADOS[x.estado]), h('span', { class: 'when' }, quando(x.quando))),
          h('p', { class: 'micro muted' }, nomeDe(x.ator_id), x.nota ? ' · ' + x.nota : ''))))) : null,
      podeReg && opcoes().length ? h('div', { class: 'row', style: 'margin-top:12px' }, opcoes().map(([estado, rot]) => h('button', {
        class: 'btn sm', onclick: async () => {
          const v = await pedir({ title: rot, submitLabel: 'Registrar', fields: [{ name: 'nota', label: 'Observação', type: 'textarea', maxlength: 300, hint: estado === 'envio_tentado' ? 'Tentativa registrada. Sem confirmação, o caso NÃO pode ser concluído.' : null }] });
          if (!v) return;
          await agir(registrarEntrega({ solicitacao_id: id, modo: e.modo, estado, nota: v.nota, papeis: ctx.papeis, ator: ctx.ator }), 'Entrega atualizada.');
        },
      }, rot))) : null);
  }

  // ---------------------------------------------------------------- comunicações, tarefas, histórico
  function blocoComunicacoes() {
    if (!ctx.pode('comunicacao_ver')) return null;
    const podeReg = ctx.pode('comunicacao_registrar', 'editar');
    return painel('Comunicações', podeReg && h('button', { class: 'btn sm', onclick: novaComunicacao }, 'Registrar'),
      nota('', 'O sistema não envia nada. Cada linha é o registro do que foi feito fora dele, com o resultado conhecido.'),
      d.comunicacoes.length
        ? h('ul', { class: 'tl', style: 'margin-top:12px' }, [...d.comunicacoes].reverse().map((c) => h('li', { class: c.tipo === 'contato_paciente' ? 'marco' : '' },
          h('div', { class: 'row between' },
            h('span', { class: 'row' }, h('b', {}, F.COM_TIPOS[c.tipo]), badge(F.RESULTADOS[c.resultado], F.CONTATO_EFETIVO.includes(c.resultado) ? 'ok' : c.resultado === 'registrada' ? 'dim' : 'warn')),
            h('span', { class: 'when' }, quando(c.criado_em))),
          h('p', { class: 'micro muted' }, F.CANAIS[c.canal], ' · ', nomeDe(c.ator_id), c.destinatario ? ` → ${c.destinatario}` : ''),
          c.texto && h('p', { class: 'small', style: 'white-space:pre-wrap;margin-top:3px' }, c.texto))))
        : h('p', { class: 'small muted', style: 'margin-top:12px' }, 'Nenhuma comunicação registrada.'));
  }

  function novaComunicacao() {
    formModal({
      title: 'Registrar comunicação',
      submitLabel: 'Registrar',
      fields: [
        { name: 'tipo', label: 'Tipo', type: 'select', value: 'contato_paciente', options: Object.entries(F.COM_TIPOS) },
        { name: 'canal', label: 'Canal', type: 'select', value: 'telefone', options: Object.entries(F.CANAIS) },
        { name: 'resultado', label: 'Resultado', type: 'select', value: 'falou', options: Object.entries(F.RESULTADOS), hint: 'Obrigatório no contato com o paciente: tentativa não é confirmação.' },
        { name: 'texto', label: 'O que foi dito ou publicado', type: 'textarea', maxlength: 1000 },
      ],
      onSubmit: async (v) => {
        const r = await agir(registrarComunicacao({ solicitacao_id: id, destinatario: v.tipo === 'contato_paciente' ? d.paciente.nome : 'Grupo operacional', ...v, papeis: ctx.papeis, ator: ctx.ator }), 'Comunicação registrada.');
        return r ? undefined : false;
      },
    });
  }

  function blocoTarefas() {
    if (!ctx.pode('tarefa_ver')) return null;
    const pend = d.tarefas.filter((t) => t.estado === 'pendente');
    const feitas = d.tarefas.filter((t) => t.estado === 'concluida');
    const linha = (t, fim) => h('li', { class: 'row between' },
      h('span', {}, fim ? h('span', { class: 'small muted' }, t.titulo) : h('span', { class: 'small' }, t.titulo),
        h('div', { class: 'micro muted' }, PAPEIS[t.papel_responsavel] + (t.responsavel_id ? ' · ' + nomeDe(t.responsavel_id) : ''))),
      fim ? badge('concluída', 'dim')
        // Só a equipe dona da tarefa a conclui: para as outras fica o rótulo, não um botão que o
        // banco recusaria. Quem é dono está em t.papel_responsavel, não na matriz de permissões.
        : ctx.papeis.includes(t.papel_responsavel)
          ? h('button', { class: 'btn sm', onclick: () => agir(concluirTarefa({ id: t.id, papeis: ctx.papeis, ator: ctx.ator }), 'Tarefa concluída.') }, 'Concluir')
          : badge('pendente', 'warn'));
    return painel('Tarefas', pend.length ? badge(`${pend.length} pendente${pend.length > 1 ? 's' : ''}`, 'warn') : badge('nenhuma pendente', 'ok'),
      pend.length || feitas.length
        ? h('ul', { class: 'ul-list' }, pend.map((t) => linha(t, false)), feitas.map((t) => linha(t, true)))
        : h('p', { class: 'small muted' }, 'Nenhuma tarefa.'));
  }

  function blocoHistorico() {
    return painel('Linha do tempo', h('span', { class: 'micro muted' }, `${d.eventos.length} eventos`),
      nota('', 'Somente acréscimo: reabertura e cancelamento não apagam nada.'),
      h('ul', { class: 'tl', style: 'margin-top:12px' }, [...d.eventos].reverse().map((e) => h('li', { class: F.ETAPAS_FIM.includes(e.para_etapa) ? 'marco' : '' },
        h('div', { class: 'row between' },
          // `titulo` existe nos eventos que não são mudança de etapa (assumir, liberar): sem ele a
          // linha sairia como "Com o médico → Com o médico".
          h('b', {}, e.titulo || (e.de_etapa ? `${F.ETAPAS[e.de_etapa]} → ${F.ETAPAS[e.para_etapa]}` : F.ETAPAS[e.para_etapa])),
          h('span', { class: 'when' }, quando(e.criado_em))),
        h('p', { class: 'micro muted' }, nomeDe(e.ator_id), e.nota ? ' · ' + e.nota : '')))));
  }

  function montar() {
    return h('div', {},
      pageHead(F.TIPOS[d.sol.tipo], '#' + d.sol.protocolo, null,
        h('button', { class: 'btn sm', onclick: () => copyText(String(d.sol.protocolo)) }, icon('copy'), 'Copiar protocolo'),
        h('button', { class: 'btn sm', onclick: () => window.print() }, icon('print'), 'Imprimir'),
        h('a', { class: 'btn sm', href: ROOT + 'solicitacoes/' }, 'Voltar à lista')),
      blocoTrilha(),
      blocoProxima(),
      h('div', { class: 'det' },
        h('div', { class: 'main' }, blocoClinico(), blocoDocumentos(), blocoEntrega(), blocoComunicacoes(), blocoHistorico()),
        h('div', { class: 'aside' }, blocoResumo(), blocoProntuario(), blocoTarefas())));
  }

  pintar();

  // A fila manda "#acao=T03" quando o próximo passo precisa de informação: em vez de executar
  // pela metade lá, ela traz quem clicou para cá e o formulário certo já abre. O id some da barra
  // de endereço depois, para um F5 não reabrir o formulário de uma ação já feita.
  const pedida = /^#acao=([A-Z0-9]+)$/.exec(location.hash)?.[1];
  if (pedida) {
    history.replaceState(null, '', location.pathname + location.search);
    const t = F.transicoesDe(d.sol, ctx.papeis).find((x) => x.id === pedida);
    if (t) executar(t);
  }
});
