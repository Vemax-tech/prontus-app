// PRONTUS — configuração da clínica: as metas de prazo por etapa e a regra de conclusão.
//
// Esta tela existe porque o sistema passou a dizer "atrasada", e dizer isso sem que a clínica
// tenha definido o prazo seria inventar número. Aqui é onde o prazo deixa de ser palpite nosso e
// vira decisão de quem opera — e, por isso, onde o alerta de pedido parado ganha legitimidade.
//
// Em produção é uma tabela com RLS: só quem administra escreve, e a mudança entra na auditoria.
import * as F from '../fluxo.js';
import { configAtual, salvarConfig } from '../dados.js';
import { METAS_PADRAO } from '../prazos.js';
import { MODELOS_PADRAO, CAMPOS_MODELO, montar } from '../mensagens.js';
import { start, h, run, pageHead, empty, badge, nota, icon } from '../ui.js';

/** Como cada modelo aparece nesta tela: onde ele é usado, em uma linha. */
const ONDE_USA = {
  pedido_prontuario: 'Call Center → grupo, ao pedir a pasta ao arquivo',
  aviso_retorno: 'Recepção → grupo, quando o médico respondeu',
  aviso_receita: 'Recepção → grupo, quando a receita ficou pronta',
  contato_paciente: 'Call Center → paciente, no WhatsApp',
};

/** Um caso de mentira só para a prévia: mostra como o texto fica preenchido, sem dado real. */
const EXEMPLO = {
  protocolo: '1042', paciente: 'Maria Aparecida Souza', primeiro_nome: 'Maria',
  prontuario: 'PR-2002', estante: 'B-11', tipo: 'Solicitação de receita médica',
  medico: 'Dra. Helena Fontes', clinica: 'Clínica (demonstração)',
  assunto: 'A sua receita já está pronta aqui na clínica.',
};

/** Linha vazia da lista de médicos. */
const MEDICO_NOVO = () => ({ nome: '', registro: '', especialidade: '' });

/** As etapas que podem ter meta: as terminais não têm, porque nelas nada mais é esperado. */
const ETAPAS_COM_META = Object.keys(F.ETAPAS).filter((e) => !F.ETAPAS_FIM.includes(e));

/** Quem age em cada etapa — a meta cobra uma equipe, então ela precisa estar escrita ao lado. */
const equipeDa = (etapa) => F.proximaAcao({ etapa, tipo: 'duvida_correcao' }).papel || '—';

export const init = () => start('configuracoes/', 'Configurações', async (ctx, view) => {
  if (!ctx.pode('configuracoes')) {
    view.append(
      pageHead('Administração', 'Configurações', 'As regras que a clínica define para si.'),
      empty('Esta tela é da administração da clínica. Troque o papel na barra superior para vê-la.'));
    return;
  }
  const podeEditar = ctx.pode('configuracoes', 'editar');
  const cfg = configAtual();
  const rascunho = {
    metas: { ...cfg.metas },
    exigirArquivamentoParaConcluir: cfg.exigirArquivamentoParaConcluir,
    medicos: (cfg.medicos || []).map((m) => ({ ...m })),
    mensagens: { ...MODELOS_PADRAO, ...cfg.mensagens },
  };

  const corpo = h('div');
  const avisoSalvar = h('div', { class: 'row', style: 'margin-top:16px;gap:10px;align-items:center' });

  const sujo = () => JSON.stringify(rascunho) !== JSON.stringify({
    metas: cfg.metas,
    exigirArquivamentoParaConcluir: cfg.exigirArquivamentoParaConcluir,
    medicos: cfg.medicos || [],
    mensagens: { ...MODELOS_PADRAO, ...cfg.mensagens },
  });

  function pintarBotoes() {
    avisoSalvar.replaceChildren(
      h('button', {
        class: 'btn primary', type: 'button', disabled: !podeEditar || !sujo() ? '' : null,
        onclick: async () => {
          const r = await run(salvarConfig({ ...rascunho, papeis: ctx.papeis, ator: ctx.ator }), 'Configuração salva. Os alertas já usam os novos prazos.');
          if (r) location.reload();
        },
      }, 'Salvar configuração'),
      sujo() ? h('span', { class: 'small', style: 'color:var(--warn)' }, 'Há mudanças não salvas.') : null,
      h('button', {
        class: 'btn sm', type: 'button',
        onclick: () => { ETAPAS_COM_META.forEach((e) => { rascunho.metas[e] = METAS_PADRAO[e]; }); pintar(); },
      }, 'Voltar aos valores propostos'));
  }

  /**
   * A lista de médicos da clínica. Eles NÃO são usuários: não entram no sistema, não têm fila e
   * não têm senha. Esta lista existe só para a Recepção escolher a quem levou o caso e para o
   * retorno sair assinado com o nome e o registro certos — sem digitar tudo de novo a cada vez,
   * que é como nasce "Dra. Helena" numa linha e "helena fontes" na outra.
   */
  function painelMedicos() {
    const linha = (m, i) => h('tr', {},
      h('td', {}, h('input', {
        type: 'text', value: m.nome, maxlength: '80', placeholder: 'Dra. Fulana de Tal', style: 'width:100%',
        disabled: podeEditar ? null : '', 'aria-label': `Nome do médico ${i + 1}`,
        oninput: (e) => { m.nome = e.target.value; pintarBotoes(); },
      })),
      h('td', {}, h('input', {
        type: 'text', value: m.registro, maxlength: '40', placeholder: 'CRM/SP 000000', style: 'width:100%',
        disabled: podeEditar ? null : '', 'aria-label': `Registro profissional do médico ${i + 1}`,
        oninput: (e) => { m.registro = e.target.value; pintarBotoes(); },
      })),
      h('td', {}, h('input', {
        type: 'text', value: m.especialidade || '', maxlength: '60', placeholder: 'Clínica geral', style: 'width:100%',
        disabled: podeEditar ? null : '', 'aria-label': `Especialidade do médico ${i + 1}`,
        oninput: (e) => { m.especialidade = e.target.value; pintarBotoes(); },
      })),
      h('td', {}, podeEditar
        ? h('button', {
          class: 'btn sm danger', type: 'button',
          onclick: () => { rascunho.medicos.splice(i, 1); pintar(); },
        }, 'Remover')
        : null));

    return h('section', { class: 'panel', style: 'margin-top:16px' },
      h('div', { class: 'ph' },
        h('div', {},
          h('h2', {}, 'Médicos da clínica'),
          h('p', { class: 'micro muted' }, 'Quem atende. Não são usuários do sistema.')),
        badge(`${rascunho.medicos.length} na lista`, rascunho.medicos.length ? 'info' : 'crit')),
      h('div', { class: 'pb' },
        nota('', 'O médico não entra no Prontus: o caso vai até ele em papel, com o prontuário, e a Recepção registra o retorno. Esta lista é só para a Recepção escolher a quem levou e para o registro sair assinado com o nome e o CRM certos. Lista vazia não trava nada — a Recepção digita na hora.'),
        h('div', { class: 'tw', style: 'margin-top:12px' },
          h('table', {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Nome'), h('th', {}, 'Registro profissional'), h('th', {}, 'Especialidade'), h('th', {}, ''))),
            h('tbody', {}, rascunho.medicos.length
              ? rascunho.medicos.map(linha)
              : h('tr', {}, h('td', { colspan: '4', class: 'small muted' }, 'Nenhum médico cadastrado.'))))),
        podeEditar
          ? h('button', {
            class: 'btn sm', type: 'button', style: 'margin-top:12px',
            onclick: () => { rascunho.medicos.push(MEDICO_NOVO()); pintar(); },
          }, 'Adicionar médico')
          : null));
  }

  /**
   * OS RECADOS QUE O SISTEMA ESCREVE.
   *
   * O sistema não envia mensagem nenhuma — quem publica no grupo e quem fala com o paciente é a
   * equipe. O que ele faz é escrever o texto, com os dados que já tem, e abrir o WhatsApp com ele
   * pronto. Por isso o texto precisa ser DA CLÍNICA: cada uma fala de um jeito, e um recado que
   * não soa como o da casa é um recado que a equipe vai reescrever na mão — o que anularia o
   * ganho inteiro.
   *
   * A prévia embaixo de cada campo usa um caso de mentira: é a única forma de ver o resultado
   * sem abrir um atendimento real só para conferir uma vírgula.
   */
  function painelMensagens() {
    const campo = (chave) => {
      const previa = h('p', { class: 'micro muted previa' });
      const atualizar = () => { previa.textContent = montar(rascunho.mensagens[chave], EXEMPLO); };
      atualizar();
      return h('div', { class: 'modelo' },
        h('label', { for: 'mod_' + chave },
          h('b', {}, ONDE_USA[chave]),
          h('span', { class: 'micro muted' }, ' · ', chave)),
        h('textarea', {
          id: 'mod_' + chave, rows: '2', maxlength: '600', value: rascunho.mensagens[chave],
          disabled: podeEditar ? null : '',
          oninput: (e) => { rascunho.mensagens[chave] = e.target.value; atualizar(); pintarBotoes(); },
        }),
        previa);
    };

    return h('section', { class: 'panel', style: 'margin-top:16px' },
      h('div', { class: 'ph' },
        h('div', {},
          h('h2', {}, 'Recados que o sistema escreve'),
          h('p', { class: 'micro muted' }, 'O texto que aparece pronto na hora de avisar. Quem envia continua sendo a equipe.')),
        badge(`${Object.keys(MODELOS_PADRAO).length} modelos`, 'info')),
      h('div', { class: 'pb' },
        nota('', 'Entre chaves vai um dado do caso, que o sistema troca na hora: '
          + Object.entries(CAMPOS_MODELO).map(([k, v]) => `{${k}} = ${v}`).join(' · ')
          + '. Uma chave escrita errado fica no texto como está, em vez de sumir — some do recado é pior que aparecer.'),
        h('div', { style: 'margin-top:12px' }, Object.keys(MODELOS_PADRAO).map(campo)),
        podeEditar
          ? h('button', {
            class: 'btn sm', type: 'button', style: 'margin-top:4px',
            onclick: () => { rascunho.mensagens = { ...MODELOS_PADRAO }; pintar(); },
          }, 'Restaurar os textos de fábrica')
          : null));
  }

  function linhaMeta(etapa) {
    const v = rascunho.metas[etapa];
    return h('tr', {},
      h('td', {}, h('b', {}, F.ETAPAS[etapa]), h('div', { class: 'micro muted' }, 'cobra: ' + equipeDa(etapa))),
      h('td', {},
        h('input', {
          type: 'number', min: '1', max: '720', step: '1', value: v == null ? '' : String(v),
          placeholder: 'sem meta', style: 'width:110px', disabled: podeEditar ? null : '',
          'aria-label': `Meta em horas para "${F.ETAPAS[etapa]}"`,
          oninput: (e) => {
            const n = e.target.value.trim();
            rascunho.metas[etapa] = n === '' ? null : Number(n);
            pintarBotoes();
          },
        }),
        h('span', { class: 'small muted', style: 'margin-left:8px' }, 'horas')),
      h('td', { class: 'small muted' }, v == null
        ? 'sem meta: esta etapa nunca entra em "atrasada"'
        : `atenção a partir de ${(v * 0.75).toFixed(v * 0.75 % 1 ? 1 : 0)} h, atrasada depois de ${v} h`),
      h('td', { class: 'small muted' }, METAS_PADRAO[etapa] == null ? '—' : METAS_PADRAO[etapa] + ' h'));
  }

  function pintar() {
    corpo.replaceChildren(
      h('section', { class: 'panel' },
        h('div', { class: 'ph' },
          h('div', {},
            h('h2', {}, 'Metas de prazo por etapa'),
            h('p', { class: 'micro muted' }, 'É o que transforma "tempo parado" em alerta de pedido parado.')),
          badge(`${ETAPAS_COM_META.filter((e) => rascunho.metas[e] != null).length} de ${ETAPAS_COM_META.length} com meta`, 'info')),
        h('div', { class: 'pb' },
          nota('', 'Os valores propostos são um ponto de partida, não uma recomendação clínica: só a clínica sabe o que é aceitável em cada etapa. Deixar o campo vazio desliga o alerta daquela etapa — melhor sem meta do que com uma meta inventada.'),
          h('div', { class: 'tw', style: 'margin-top:12px' },
            h('table', {},
              h('thead', {}, h('tr', {},
                h('th', {}, 'Etapa'), h('th', {}, 'Meta'), h('th', {}, 'O que o sistema faz'), h('th', {}, 'Proposto'))),
              h('tbody', {}, ETAPAS_COM_META.map(linhaMeta)))))),

      painelMedicos(),

      painelMensagens(),

      h('section', { class: 'panel', style: 'margin-top:16px' },
        h('div', { class: 'ph' }, h('h2', {}, 'Quando um caso pode ser concluído')),
        h('div', { class: 'pb' },
          h('label', { class: 'opcao' },
            h('input', {
              type: 'checkbox', disabled: podeEditar ? null : '',
              checked: rascunho.exigirArquivamentoParaConcluir ? '' : null,
              onchange: (e) => { rascunho.exigirArquivamentoParaConcluir = e.target.checked; pintarBotoes(); },
            }),
            h('span', {},
              h('b', {}, 'Exigir o prontuário arquivado para concluir o atendimento'),
              h('div', { class: 'small muted', style: 'margin-top:4px' },
                'Ligado, o sistema recusa a conclusão enquanto a pasta não voltou ao arquivo. Desligado, avisa e deixa concluir — a devolução continua pendente na fila do arquivo.'))),
          nota('', 'As duas leituras são defensáveis e por isso a escolha é da clínica. O documento de planejamento pede a regra ligada ("só vira Concluído quando o paciente foi avisado e o prontuário está de volta"). Este sistema nasceu com ela desligada, porque na prática a receita fica pronta enquanto a pasta ainda está voltando, e travar a conclusão por causa do arquivo faz a fila mostrar como pendente um atendimento que terminou.'))),

      avisoSalvar);
    pintarBotoes();
  }

  view.append(
    pageHead('Administração', 'Configurações',
      'O que a clínica define para si: os prazos que geram alerta, quem atende, os recados que o sistema escreve e a regra de conclusão.'),
    corpo,
    h('p', { class: 'micro muted', style: 'margin-top:20px' }, icon('shield'),
      ' Mudança de configuração entra na auditoria com quem mudou e quando.'));
  pintar();
});
