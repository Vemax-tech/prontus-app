// PRONTUS — a matriz de papéis e permissões, visível dentro do próprio sistema.
// Não é enfeite: é a tela que mostra QUEM acessa O QUÊ, e que o desenho responde à exigência de
// o administrador não ganhar acesso clínico por ser administrador.
import { matriz, PAPEIS, PAPEL_RESUMO, RECURSO_ROTULO } from '../permissoes.js';
import { listar, nomeDe } from '../dados.js';
import { start, h, run, pageHead, badge, sec, icon, nota } from '../ui.js';

const LEGENDA = {
  E: ['E', 'Edita / registra', 'n-E'],
  V: ['V', 'Vê o conteúdo', 'n-V'],
  Vm: ['Vm', 'Vê o mínimo necessário', 'n-Vm'],
};

export const init = () => start('permissoes/', 'Papéis e permissões', async (ctx, view) => {
  const m = matriz();
  const auditoria = await run(listar('auditoria'));
  const meu = ctx.papeis[0];

  const cabecalho = h('tr', {}, h('th', {}, 'Recurso e ação'), ...m.papeis.map((p) => h('th', { class: p === meu ? 'meu' : null }, PAPEIS[p])));
  const linhas = m.recursos.map((r) => h('tr', {},
    h('td', {}, RECURSO_ROTULO[r] || r),
    ...m.papeis.map((p) => {
      const n = m.celula(r, p);
      return h('td', { class: 'n ' + (n ? LEGENDA[n][2] : 'n-no') }, n || '·');
    })));

  const destaques = [
    ['O sistema não guarda texto clínico.', 'O médico decide em papel, e a Recepção registra só o resultado — receita emitida, corrigida, respondida ou não aprovada —, assinando com o nome e o CRM de quem decidiu. O Call Center repassa ao paciente uma frase pronta sobre esse resultado, sem ler nada clínico.'],
    ['O relato do paciente é o dado sensível que sobra.', 'Só o Call Center, que o recebe, e a Recepção, que leva o caso ao médico, o leem — e cada leitura entra na auditoria. O Arquivo e o Administrador não leem.'],
    ['O Arquivo tem acesso mínimo.', 'Para localizar um prontuário bastam o código e onde a pasta está. Ele não lê o nome do paciente, o relato, o retorno médico nem o documento.'],
    ['O Administrador não ganha acesso por administrar.', 'Ele cria e desativa pessoas, define as metas de prazo, tira relatórios e acompanha todos os casos — mas não lê o relato nem a identificação do paciente. Coordenar não é motivo para ver dado de saúde.'],
  ];

  view.append(
    pageHead('Administração', 'Papéis e permissões',
      `Quatro papéis, quatro fluxos de trabalho. Você está vendo o sistema como ${PAPEIS[meu]} — ${(PAPEL_RESUMO[meu] || '').toLowerCase()} Troque o papel na barra superior para ver o efeito.`),

    nota('info',
      h('b', {}, 'Na demonstração '), 'esta matriz está em JavaScript, para você poder trocar de papel na hora. ',
      h('b', {}, 'Em produção '), 'ela é dado no banco e a verificação acontece dentro de cada função que altera algo, recusando com o código 42501. O navegador nunca decide permissão — ele só evita mostrar botão que não funcionaria.'),

    sec('A matriz', h('section', { class: 'card' },
      h('div', { class: 'row', style: 'gap:16px;margin-bottom:12px' }, Object.values(LEGENDA).map(([sig, txt, cls]) => h('span', { class: 'small' }, h('b', { class: cls }, sig), ' = ' + txt)),
        h('span', { class: 'small' }, h('b', { class: 'n-no' }, '·'), ' = sem acesso')),
      h('div', { class: 'tw matriz' }, h('table', {}, h('thead', {}, cabecalho), h('tbody', {}, linhas))))),

    sec('Os quatro papéis em uma linha', h('div', { class: 'grid g2' },
      Object.entries(PAPEIS).map(([p, rot]) => h('section', { class: 'card' + (p === meu ? ' on' : '') },
        h('h3', { style: 'margin-bottom:6px' }, rot, p === meu ? badge('você', 'info') : null),
        h('p', { class: 'small muted' }, PAPEL_RESUMO[p]))))),

    sec('As quatro decisões que esta matriz toma', h('div', { class: 'grid g2' },
      destaques.map(([t, p]) => h('section', { class: 'card' }, h('h3', { style: 'margin-bottom:8px' }, t), h('p', { class: 'small muted' }, p))))),

    sec('Auditoria de acesso', h('section', { class: 'card' },
      h('p', { class: 'small muted', style: 'margin-bottom:12px' }, 'Dado de saúde exige registrar também a ', h('b', {}, 'leitura'), ', não só a alteração: num sistema comum basta auditar quem mudou o quê; aqui, abrir uma avaliação ou um documento já gera uma linha.'),
      auditoria.length
        ? h('div', { class: 'tw' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Quando'), h('th', {}, 'Ação'), h('th', {}, 'Recurso'), h('th', {}, 'Quem'), h('th', {}, 'Papel'))),
          h('tbody', {}, [...auditoria].reverse().slice(0, 20).map((a) => h('tr', {},
            h('td', { class: 'small' }, new Date(a.quando).toLocaleString('pt-BR')),
            h('td', {}, badge(a.acao, a.acao === 'leitura' ? 'warn' : 'dim')),
            h('td', { class: 'small' }, a.recurso),
            h('td', { class: 'small' }, nomeDe(a.ator_id)),
            h('td', { class: 'small muted' }, (a.papeis || []).map((p) => PAPEIS[p]).join(', ')))))))
        : h('p', { class: 'small muted' }, 'Nenhum acesso registrado nesta sessão. Abra uma avaliação médica ou um documento e volte aqui.'))),

    h('p', { class: 'micro muted', style: 'margin-top:24px' }, icon('shield'), ' A matriz desta tela é a mesma que js/permissoes.js aplica em cada ação — não é uma cópia que possa divergir.'),
  );
});
