// PRONTUS — usuários e papéis. A tela que justifica o papel de Administrador existir.
//
// O que ela resolve: hoje, criar ou tirar um acesso é um pedido ao fornecedor. Aqui é a própria
// clínica que faz, e cada mudança entra na auditoria com quem mudou e quando.
//
// Duas decisões visíveis na tela, e as duas são sobre histórico de dado de saúde:
//
//  · QUEM JÁ AGIU NÃO É APAGADO, É DESATIVADO. O nome de quem assumiu um caso, moveu um
//    prontuário ou registrou um retorno fica na linha do tempo para sempre. Apagar o registro
//    deixaria "—" no lugar da autoria, e autoria é metade do valor de uma trilha de auditoria.
//    O botão é o mesmo — "Excluir" —, mas a tela diz, antes e depois, qual dos dois aconteceu.
//  · NINGUÉM FICA SEM ADMINISTRADOR. Tirar o último admin trancaria a clínica para fora da
//    própria administração. A camada de dados recusa, e aqui o botão já nem aparece.
//
// Em produção isto vira convite por e-mail e conta de verdade; a forma da tela não muda.
import { listar, criarUsuario, atualizarUsuario, excluirUsuario } from '../dados.js';
import {
  start, h, run, pageHead, badge, icon, nota, toast, formModal, confirmDlg, dataTable, filtros, contem,
} from '../ui.js';
import { PAPEIS, PAPEL_RESUMO } from '../permissoes.js';

const OPCOES_PAPEL = Object.entries(PAPEIS);
const quando = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

export const init = () => start('usuarios/', 'Usuários', async (ctx, view) => {
  const estado = { sort: 'nome', dir: 1, page: 0 };
  const filtro = { q: '', papel: '', situacao: '' };
  const corpo = h('div');

  const recarregar = async () => (await run(listar('usuarios'))) || [];
  let usuarios = await recarregar();

  const atualizar = async () => { usuarios = await recarregar(); pintar(); };

  /** O formulário é o mesmo para criar e para editar: os mesmos campos, as mesmas regras. */
  function ficha(u) {
    const novo = !u;
    formModal({
      title: novo ? 'Novo usuário' : `Editar ${u.nome}`,
      submitLabel: novo ? 'Criar usuário' : 'Salvar',
      fields: [
        { name: 'nome', label: 'Nome completo', required: true, maxlength: 80, value: u?.nome || '' },
        { name: 'email', label: 'E-mail', type: 'email', maxlength: 120, value: u?.email || '', hint: 'Em produção é por aqui que chega o convite de acesso. Na demonstração é só identificação.' },
        { name: 'cargo', label: 'Cargo', maxlength: 60, value: u?.cargo || '', hint: 'Como a pessoa é chamada na clínica. Aparece ao lado do nome na barra superior.' },
        {
          name: 'papel', label: 'Papel', type: 'select', value: u?.papeis?.[0] || 'callcenter', options: OPCOES_PAPEL,
          hint: 'Um papel por pessoa: é o papel que decide quais telas ela vê e qual fila é dela.',
        },
      ],
      onSubmit: async (v) => {
        const r = novo
          ? await run(criarUsuario({ ...v, papeis: ctx.papeis, ator: ctx.ator }), `${v.nome} agora tem acesso como ${PAPEIS[v.papel]}.`)
          : await run(atualizarUsuario({ id: u.id, ...v, papeis: ctx.papeis, ator: ctx.ator }), 'Usuário atualizado.');
        if (!r) return false;
        await atualizar();
      },
    });
  }

  async function alternarAtivo(u) {
    const desativando = u.ativo !== false;
    if (desativando && !await confirmDlg(
      `Desativar ${u.nome}? A pessoa deixa de entrar e some das filas, mas tudo o que ela já fez continua no histórico com o nome dela.`)) return;
    const r = await run(
      atualizarUsuario({ id: u.id, ativo: !desativando, papeis: ctx.papeis, ator: ctx.ator }),
      desativando ? `${u.nome} foi desativado.` : `${u.nome} voltou a ter acesso.`);
    if (r) await atualizar();
  }

  async function excluir(u) {
    if (!await confirmDlg(
      `Excluir ${u.nome}? Se esta pessoa já agiu no sistema, ela será DESATIVADA em vez de apagada`
      + ' — o histórico de um registro de saúde não pode perder a autoria.')) return;
    const r = await run(excluirUsuario({ id: u.id, papeis: ctx.papeis, ator: ctx.ator }));
    if (!r) return;
    await atualizar();
    // A mensagem diz o que REALMENTE aconteceu, não o que o botão prometia.
    toast(r.removido
      ? `${r.nome} foi excluído: nunca tinha agido no sistema.`
      : `${r.nome} foi desativado em vez de excluído — há ${r.rastro} registro(s) no histórico com o nome dele.`);
  }

  function linhaAcoes(u) {
    const ativo = u.ativo !== false;
    const euMesmo = u.id === ctx.ator;
    return h('div', { class: 'row' },
      h('button', { class: 'btn sm', onclick: () => ficha(u) }, 'Editar'),
      euMesmo
        ? badge('é você', 'info')
        : [
          h('button', { class: 'btn sm', onclick: () => alternarAtivo(u) }, ativo ? 'Desativar' : 'Reativar'),
          h('button', { class: 'btn sm danger', onclick: () => excluir(u) }, 'Excluir'),
        ]);
  }

  function pintar() {
    const lista = usuarios.filter((u) => contem([u.nome, u.email || '', u.cargo || ''], filtro.q)
      && (!filtro.papel || u.papeis.includes(filtro.papel))
      && (!filtro.situacao || (filtro.situacao === 'ativo') === (u.ativo !== false)));

    const ativos = usuarios.filter((u) => u.ativo !== false);
    const porPapel = Object.keys(PAPEIS).map((p) => ({ p, n: ativos.filter((u) => u.papeis.includes(p)).length }));

    const tabela = dataTable({
      cols: [
        {
          key: 'nome',
          label: 'Pessoa',
          sort: (u) => u.nome.toLowerCase(),
          render: (u) => h('span', {},
            h('b', {}, u.nome),
            h('div', { class: 'micro muted' }, u.email || 'sem e-mail')),
        },
        { key: 'cargo', label: 'Cargo', sort: (u) => (u.cargo || '').toLowerCase(), render: (u) => h('span', { class: 'small' }, u.cargo || '—') },
        {
          key: 'papel',
          label: 'Papel',
          sort: (u) => PAPEIS[u.papeis[0]] || '',
          render: (u) => h('span', {},
            badge(PAPEIS[u.papeis[0]] || u.papeis[0], u.papeis.includes('admin') ? 'info' : ''),
            h('div', { class: 'micro muted' }, PAPEL_RESUMO[u.papeis[0]] || '')),
        },
        {
          key: 'situacao',
          label: 'Situação',
          sort: (u) => (u.ativo !== false ? 0 : 1),
          render: (u) => (u.ativo !== false ? badge('ativo', 'ok') : badge('desativado', 'dim')),
        },
        { key: 'criado', label: 'Desde', sort: (u) => u.criado_em || '', render: (u) => h('span', { class: 'small muted' }, u.criado_em ? quando(u.criado_em) : 'da implantação') },
        { key: 'acoes', label: '', render: linhaAcoes },
      ],
      rows: lista,
      state: estado,
      onState: pintar,
      rowClass: (u) => (u.ativo === false ? 'off' : null),
      vazio: h('p', { class: 'small muted' }, 'Nenhum usuário com esses filtros.'),
    });

    corpo.replaceChildren(
      h('section', { class: 'panel' },
        h('div', { class: 'ph' },
          h('div', {},
            h('h2', {}, 'Pessoas com acesso'),
            h('p', { class: 'micro muted' }, porPapel.map(({ p, n }) => `${n} ${PAPEIS[p]}`).join(' · '))),
          h('button', { class: 'btn primary', onclick: () => ficha(null) }, 'Novo usuário')),
        h('div', { class: 'pb' },
          filtros([
            { tipo: 'busca', chave: 'q', placeholder: 'Buscar por nome, e-mail ou cargo' },
            { tipo: 'select', chave: 'papel', rotulo: 'Qualquer papel', opcoes: OPCOES_PAPEL },
            { tipo: 'select', chave: 'situacao', rotulo: 'Ativos e desativados', opcoes: [['ativo', 'Só ativos'], ['inativo', 'Só desativados']] },
          ], filtro, pintar),
          h('div', { style: 'margin-top:12px' }, tabela))));
  }

  view.append(
    pageHead('Administração', 'Usuários e papéis',
      'Quem entra no sistema, com qual papel, e o que acontece quando alguém sai da clínica.'),

    nota('info',
      h('b', {}, 'O médico não aparece nesta lista '), 'porque não é usuário do sistema: o caso é levado'
      + ' a ele em papel, com o prontuário, e a Recepção registra o retorno. Quem atende na clínica é uma'
      + ' lista mantida em ', h('b', {}, 'Configurações'), ', usada para assinar o retorno com o nome e o registro certos.'),

    corpo,

    h('p', { class: 'micro muted', style: 'margin-top:20px' }, icon('shield'),
      ' Criar, editar, desativar e excluir entram na auditoria. Quem já agiu no sistema é desativado em'
      + ' vez de apagado: a linha do tempo de um registro de saúde não pode perder a autoria.'));

  pintar();
});
