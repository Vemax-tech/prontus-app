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
  registrarEntrega, concluirTarefa, auditarLeitura, nomeDe,
  assumirSolicitacao, liberarSolicitacao,
} from '../dados.js';
import {
  start, h, run, pageHead, badge, icon, modal, formModal, confirmDlg, copyText,
  fmtDate, qs, desde, corEtapa, nota,
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
  duvida_correcao: ['aberta', 'aguardando_prontuario', 'prontuario_em_transito', 'prontuario_na_recepcao', 'aguardando_medico', 'retorno_disponivel', 'aguardando_contato_paciente', 'concluida'],
  pedido_receita: ['aberta', 'aguardando_prontuario', 'prontuario_em_transito', 'prontuario_na_recepcao', 'aguardando_medico', 'retorno_disponivel', 'aguardando_contato_paciente', 'aguardando_entrega', 'concluida'],
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

  // ---------------------------------------------------------------- ações da solicitação
  function acoesSolicitacao() {
    const trans = F.transicoesDe(d.sol, ctx.papeis, ctx.ator);
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
    const outroMedico = ctx.papeis.includes('medico') && d.sol.medico_id && d.sol.medico_id !== ctx.ator;
    if (!daVez || outroMedico) return null;
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
    // T03: pedir o prontuário é, no processo real, publicar no grupo. Registramos a comunicação junto.
    if (t.exigeComunicacao) {
      const texto = `Protocolo ${d.sol.protocolo} — localizar o prontuário ${d.prontuario?.codigo || ''} (${d.paciente.nome}).`;
      const v = await pedir({
        title: 'Pedir o prontuário ao arquivo',
        submitLabel: 'Registrar o pedido',
        fields: [
          { name: 'canal', label: 'Canal usado', type: 'select', value: 'whatsapp_grupo', options: Object.entries(F.CANAIS) },
          { name: 'texto', label: 'Mensagem publicada', type: 'textarea', value: texto, maxlength: 1000, hint: 'O sistema NÃO envia a mensagem. Você publica no grupo e registra aqui o que foi feito.' },
        ],
      });
      if (!v) return;
      const c = await run(registrarComunicacao({ solicitacao_id: id, tipo: 'pedido_prontuario', destinatario: 'Grupo operacional', resultado: 'registrada', ...v, papeis: ctx.papeis, ator: ctx.ator }));
      if (!c) return;
      return agir(moverSolicitacao({ id, transicao: t.id, papeis: ctx.papeis, ator: ctx.ator }), 'Pedido registrado. O arquivo já vê na fila dele.');
    }
    // T07: o retorno do médico é a decisão clínica. Formulário próprio.
    if (t.id === 'T07') return registrarRetorno();
    // T12: paciente avisado -> escolher como a receita chega.
    if (t.id === 'T12') {
      const v = await pedir({
        title: 'Como a receita vai chegar ao paciente?',
        submitLabel: 'Registrar',
        fields: [
          { name: 'resultado', label: 'Resultado do contato com o paciente', type: 'select', value: 'falou', options: Object.entries(F.RESULTADOS).filter(([k]) => ['falou', 'nao_atendeu', 'recado', 'numero_invalido'].includes(k)), hint: 'Tentativa sem sucesso não conclui o caso.' },
          { name: 'modo', label: 'Forma de entrega', type: 'select', value: 'fisica', options: Object.entries(F.ENTREGA_MODOS) },
        ],
      });
      if (!v) return;
      const c = await run(registrarComunicacao({ solicitacao_id: id, canal: 'telefone', tipo: 'contato_paciente', destinatario: d.paciente.nome, resultado: v.resultado, texto: 'Paciente avisado de que a receita está pronta.', papeis: ctx.papeis, ator: ctx.ator }));
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

  // ---------------------------------------------------------------- avaliação médica
  function registrarRetorno() {
    const receita = d.sol.tipo === 'pedido_receita';
    const opcoes = receita
      ? [['receita_emitida', 'Receita emitida'], ['nao_aprovado', 'Pedido não aprovado'], ['precisa_esclarecimento', 'Preciso de mais informação']]
      : [['respondido', 'Respondido (sem alterar a receita)'], ['corrigido', 'Receita corrigida (gera nova versão)'], ['precisa_esclarecimento', 'Preciso de mais informação']];
    formModal({
      title: 'Registrar a decisão clínica',
      submitLabel: 'Registrar',
      fields: [
        { name: 'desfecho', label: 'Decisão', type: 'select', value: opcoes[0][0], options: opcoes },
        { name: 'conteudo_clinico', label: 'Conteúdo clínico', type: 'textarea', required: true, maxlength: 4000, hint: 'Visível só para quem tem permissão clínica. Não aparece para o Call Center nem para a administração.' },
        { name: 'resumo_para_paciente', label: 'Resumo para repassar ao paciente', type: 'textarea', maxlength: 600, hint: 'Opcional. Serve para o Call Center comunicar sem acessar o conteúdo clínico.' },
      ],
      onSubmit: async (v) => {
        if (v.desfecho === 'precisa_esclarecimento') {
          const a = await run(registrarAvaliacao({ solicitacao_id: id, ...v, papeis: ctx.papeis, ator: ctx.ator }));
          if (!a) return false;
          await agir(moverSolicitacao({ id, transicao: 'T08', papeis: ctx.papeis, ator: ctx.ator, nota: 'Médico pediu esclarecimento.' }), 'Pedido de esclarecimento registrado.');
          return;
        }
        const a = await run(registrarAvaliacao({ solicitacao_id: id, ...v, papeis: ctx.papeis, ator: ctx.ator }));
        if (!a) return false;
        const trans = v.desfecho === 'nao_aprovado' ? 'T14' : 'T07';
        await agir(moverSolicitacao({ id, transicao: trans, papeis: ctx.papeis, ator: ctx.ator, nota: v.desfecho === 'nao_aprovado' ? 'Pedido não aprovado.' : 'Retorno registrado.' }), 'Decisão registrada.');
      },
    });
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
    // RN-10: quando a próxima ação é do médico, ela é do médico DESTE caso — dizer "é você" a
    // outro profissional prometeria uma ação que a tela, corretamente, não oferece.
    const outroMedico = ctx.papeis.includes('medico') && d.sol.medico_id && d.sol.medico_id !== ctx.ator;
    const meu = !outroMedico && p.papel
      && (p.papel.includes(PAPEIS[ctx.papeis[0]]) || PAPEIS[ctx.papeis[0]] === p.papel);
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
        outroMedico && !fim && h('p', { class: 'small muted', style: 'margin-top:5px' },
          `A decisão clínica deste caso é de ${nomeDe(d.sol.medico_id)}, a quem ele foi encaminhado.`),
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
        d.sol.medico_id && [h('dt', {}, 'Médico'), h('dd', {}, nomeDe(d.sol.medico_id))],
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
        ? painel('Retorno do médico', badge('ainda não registrado', 'dim'), h('p', { class: 'small muted' }, 'O médico ainda não registrou a decisão deste caso.'))
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
        h('p', { class: 'micro muted', style: 'margin:5px 0 8px' }, nomeDe(a.medico_id), ' · ', a.registro_profissional),
        completo
          ? h('p', { style: 'white-space:pre-wrap' }, a.conteudo_clinico)
          : minimo
            ? h('div', {},
              a.resumo_para_paciente ? h('p', { style: 'white-space:pre-wrap' }, a.resumo_para_paciente) : null,
              nota('', 'O conteúdo clínico completo não é visível para o seu papel. Você vê o resumo autorizado.'))
            : nota('', 'O conteúdo clínico não é visível para o Call Center. Para repassar a resposta por telefone, a saída é o médico escrever um "resumo para o paciente", separado do conteúdo clínico.'))));
  }

  function blocoDocumentos() {
    if (!d.documentos.length || !ctx.pode('documento_metadados')) return null;
    const podeAbrir = ctx.pode('documento_abrir');
    return painel('Documentos', h('span', { class: 'micro muted' }, `${d.documentos.length} versão(ões)`),
      h('ul', { class: 'ul-list' }, d.documentos.map((doc) => h('li', { class: 'row between' },
        h('span', {}, h('b', {}, doc.nome), h('div', { class: 'micro muted' }, `versão ${doc.versao} · emitida por ${nomeDe(doc.emitido_por)} · ${quando(doc.criado_em)}`)),
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
          // linha sairia como "Aguardando médico → Aguardando médico".
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
});
