// PRONTUS — usuários e papéis. A tela que justifica o papel de Administrador existir.
//
// São as contas de verdade: a lista vem do banco (js/contas.js) e quem recusa quem não é
// Administrador é a RLS, não esta tela. Cada mudança de papel, nome, cargo ou situação fica na
// auditoria de contas, com quem fez e quando, e ela é mostrada aqui embaixo.
//
// Três decisões visíveis, todas sobre histórico de dado de saúde:
//
//  · QUEM JÁ AGIU NÃO É APAGADO, É DESATIVADO. O nome de quem assumiu um caso, moveu um
//    prontuário ou registrou um retorno fica na linha do tempo para sempre. Por isso não há
//    "Excluir": apagar a conta deixaria "—" no lugar da autoria, e autoria é metade do valor de
//    uma trilha de auditoria. A conta desativada não entra, e a página seguinte já expulsa quem
//    estava logado.
//  · NINGUÉM FICA SEM ADMINISTRADOR. O banco recusa desativar ou rebaixar o último, e a tela já
//    nem oferece o botão para a própria conta.
//  · CRIAR A CONTA É NO PAINEL DO SUPABASE. E-mail e senha exigem a chave de serviço, que não pode
//    estar no navegador. A conta criada lá aparece aqui como "Aguardando liberação", e o
//    Administrador só decide nome, cargo e papel.
import { listarContas, liberarConta, atualizarPerfil, listarAuditoriaContas } from '../contas.js';
import {
  start, h, run, pageHead, badge, icon, nota, formModal, confirmDlg, dataTable, filtros, contem, empty,
} from '../ui.js';
import { PAPEIS, PAPEL_RESUMO } from '../permissoes.js';

const OPCOES_PAPEL = Object.entries(PAPEIS);
const data = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

const ACOES = {
  perfil_criado: 'liberou o acesso de',
  perfil_editado: 'editou os dados de',
  papel_alterado: 'mudou o papel de',
  desativado: 'desativou',
  reativado: 'reativou',
  perfil_removido: 'removeu o perfil de',
};

export const init = () => start('usuarios/', 'Usuários', async (ctx, view) => {
  const estado = { sort: 'nome', dir: 1, page: 0 };
  const filtro = { q: '', papel: '', situacao: '' };
  const corpo = h('div');
  const trilha = h('div');

  let contas = (await run(listarContas())) || [];
  const nomeDe = (id) => { const c = contas.find((x) => x.id === id); return c ? (c.nome || c.email) : 'conta removida'; };

  async function recarregar() { contas = (await run(listarContas())) || []; pintar(); await pintarTrilha(); }

  function ficha(c) {
    const liberando = !c.temPerfil;
    formModal({
      title: liberando ? `Liberar acesso de ${c.email}` : `Editar ${c.nome}`,
      submitLabel: liberando ? 'Liberar acesso' : 'Salvar',
      fields: [
        { name: 'nome', label: 'Nome completo', required: true, maxlength: 120, value: c.nome },
        { name: 'cargo', label: 'Cargo', maxlength: 60, value: c.cargo, hint: 'Como a pessoa é chamada na clínica. Aparece ao lado do nome na barra superior.' },
        {
          name: 'papel', label: 'Papel', type: 'select', value: c.papel || 'callcenter', options: OPCOES_PAPEL,
          hint: 'Um papel por pessoa: é ele que decide quais telas ela vê e qual fila é dela. O e-mail é o da conta e não muda aqui.',
        },
      ],
      onSubmit: async (v) => {
        const r = liberando
          ? await run(liberarConta({ id: c.id, ...v }), `${v.nome} agora tem acesso como ${PAPEIS[v.papel]}.`)
          : await run(atualizarPerfil(c.id, v), 'Usuário atualizado.');
        if (!r) return false;
        await recarregar();
      },
    });
  }

  async function alternarAtivo(c) {
    const desativando = c.ativo;
    if (desativando && !await confirmDlg(
      `Desativar ${c.nome}? A pessoa deixa de entrar e é expulsa na próxima página que abrir, mas tudo o que ela já fez continua no histórico com o nome dela.`)) return;
    const r = await run(atualizarPerfil(c.id, { ativo: !desativando }),
      desativando ? `${c.nome} foi desativado.` : `${c.nome} voltou a ter acesso.`);
    if (r) await recarregar();
  }

  function acoes(c) {
    if (!c.temPerfil) return h('button', { class: 'btn sm primary', onclick: () => ficha(c) }, 'Liberar acesso');
    if (c.id === ctx.ator) return h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => ficha(c) }, 'Editar'), badge('é você', 'info'));
    return h('div', { class: 'row' },
      h('button', { class: 'btn sm', onclick: () => ficha(c) }, 'Editar'),
      h('button', { class: 'btn sm', onclick: () => alternarAtivo(c) }, c.ativo ? 'Desativar' : 'Reativar'));
  }

  const situacao = (c) => (!c.temPerfil ? badge('aguardando liberação', 'warn') : c.ativo ? badge('ativo', 'ok') : badge('desativado', 'dim'));
  const chaveSituacao = (c) => (!c.temPerfil ? 'pendente' : c.ativo ? 'ativo' : 'inativo');

  function pintar() {
    const lista = contas.filter((c) => contem([c.nome, c.email, c.cargo], filtro.q)
      && (!filtro.papel || c.papel === filtro.papel)
      && (!filtro.situacao || chaveSituacao(c) === filtro.situacao));
    const ativos = contas.filter((c) => c.ativo);
    const pendentes = contas.filter((c) => !c.temPerfil).length;
    const porPapel = Object.keys(PAPEIS).map((p) => ({ p, n: ativos.filter((c) => c.papel === p).length }));

    const tabela = dataTable({
      cols: [
        { key: 'nome', label: 'Pessoa', sort: (c) => (c.nome || c.email).toLowerCase(),
          render: (c) => h('span', {}, h('b', {}, c.nome || 'Sem nome ainda'), h('div', { class: 'micro muted' }, c.email)) },
        { key: 'cargo', label: 'Cargo', sort: (c) => c.cargo.toLowerCase(), render: (c) => h('span', { class: 'small' }, c.cargo || '—') },
        { key: 'papel', label: 'Papel', sort: (c) => PAPEIS[c.papel] || '',
          render: (c) => (c.papel
            ? h('span', {}, badge(PAPEIS[c.papel], c.papel === 'admin' ? 'info' : ''), h('div', { class: 'micro muted' }, PAPEL_RESUMO[c.papel] || ''))
            : h('span', { class: 'small muted' }, '—')) },
        { key: 'situacao', label: 'Situação', sort: chaveSituacao, render: situacao },
        { key: 'acesso', label: 'Último acesso', sort: (c) => c.ultimoAcesso || '', render: (c) => h('span', { class: 'small muted' }, c.ultimoAcesso ? dataHora(c.ultimoAcesso) : 'nunca entrou') },
        { key: 'acoes', label: '', render: acoes },
      ],
      rows: lista, state: estado, onState: pintar,
      rowClass: (c) => (c.temPerfil && !c.ativo ? 'off' : null),
      vazio: h('p', { class: 'small muted' }, 'Nenhum usuário com esses filtros.'),
    });

    corpo.replaceChildren(
      pendentes
        ? nota('warn', h('b', {}, `${pendentes} ${pendentes === 1 ? 'conta aguarda' : 'contas aguardam'} liberação. `),
          'A pessoa já tem e-mail e senha, mas ainda não entra no sistema: escolha o nome, o cargo e o papel dela.')
        : null,
      h('section', { class: 'panel' },
        h('div', { class: 'ph' },
          h('div', {},
            h('h2', {}, 'Pessoas com acesso'),
            h('p', { class: 'micro muted' }, porPapel.map(({ p, n }) => `${n} ${PAPEIS[p]}`).join(' · '))),
          h('a', { class: 'btn', href: 'https://supabase.com/dashboard', target: '_blank', rel: 'noopener noreferrer' }, 'Criar conta no painel')),
        h('div', { class: 'pb' },
          filtros([
            { tipo: 'busca', chave: 'q', placeholder: 'Buscar por nome, e-mail ou cargo' },
            { tipo: 'select', chave: 'papel', rotulo: 'Qualquer papel', opcoes: OPCOES_PAPEL },
            { tipo: 'select', chave: 'situacao', rotulo: 'Todas as situações', opcoes: [['ativo', 'Só ativos'], ['inativo', 'Só desativados'], ['pendente', 'Aguardando liberação']] },
          ], filtro, pintar),
          h('div', { style: 'margin-top:12px' }, tabela))));
  }

  async function pintarTrilha() {
    const regs = (await run(listarAuditoriaContas(15))) || [];
    trilha.replaceChildren(h('section', { class: 'panel', style: 'margin-top:20px' },
      h('div', { class: 'ph' }, h('h2', {}, 'Últimas alterações de conta'), h('span', { class: 'micro muted' }, 'gravadas pelo banco, ninguém as edita')),
      h('div', { class: 'pb' }, regs.length
        ? h('ul', { class: 'ul-list' }, regs.map((a) => h('li', {},
          h('div', { class: 'row between' },
            h('span', { class: 'small' }, h('b', {}, a.ator_id ? nomeDe(a.ator_id) : 'o banco'), ' ', ACOES[a.acao] || a.acao, ' ', h('b', {}, nomeDe(a.alvo_id)),
              a.acao === 'papel_alterado' ? ` (${PAPEIS[a.detalhe?.de] || a.detalhe?.de} → ${PAPEIS[a.detalhe?.para] || a.detalhe?.para})` : ''),
            h('span', { class: 'when' }, dataHora(a.quando))))))
        : empty('Nenhuma alteração registrada ainda.'))));
  }

  view.append(
    pageHead('Administração', 'Usuários e papéis',
      'Quem entra no sistema, com qual papel, e o que acontece quando alguém sai da clínica.'),
    nota('info',
      h('b', {}, 'O médico não aparece nesta lista '), 'porque não é usuário do sistema: o caso é levado'
      + ' a ele em papel, com o prontuário, e a Recepção registra o retorno. Quem atende na clínica é uma'
      + ' lista mantida em ', h('b', {}, 'Configurações'), ', usada para assinar o retorno com o nome e o registro certos.'),
    corpo,
    trilha,
    h('p', { class: 'micro muted', style: 'margin-top:20px' }, icon('shield'),
      ' Contas não são excluídas: quem já agiu no sistema é desativado, porque a linha do tempo de um'
      + ' registro de saúde não pode perder a autoria. Para criar uma conta nova, use o painel do Supabase'
      + ' (Authentication → Users); ela aparece aqui para você liberar.'));

  pintar();
  await pintarTrilha();
});
