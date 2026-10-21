// PRONTUS — filas de trabalho por papel. Cada equipe vê só o que é dela, na ordem em que o
// trabalho aparece no fluxo.
//
// A tela escolhe a fila à esquerda e mostra os itens em largura inteira à direita. O formato
// anterior — uma caixa por fila, lado a lado — cortava cada lista em "e mais 12…" e obrigava a
// abrir outra tela para ver o resto.
//
// ESTE ARQUIVO SERVE AS DUAS TELAS, porque elas são a mesma lista com um filtro diferente:
//
//   · FILA ATUAL  (filas/)     — o que é da vez da sua equipe e ainda não tem dono. É de onde se
//                                 ASSUME um caso. Um caso assumido sai daqui: deixou de ser
//                                 trabalho solto da equipe e passou a ter nome.
//   · MINHA FILA  (minhafila/) — o que VOCÊ assumiu. É a sua lista de responsabilidade, e é dela
//                                 que sai o número no menu.
//
// Por que separar: enquanto tudo ficava numa fila só, "a equipe tem 16 itens" não dizia quem ia
// fazer o quê, e dois atendentes podiam pegar o mesmo caso. Com a posse explícita, todo item em
// andamento tem um nome, e o que não tem aparece — sozinho — na fila de onde se pega trabalho.
//
// A trilha do prontuário físico NÃO entra nessa divisão: a custódia é controlada pelos registros
// de movimentação, não por posse de caso, e misturar os dois eixos é exatamente o que o resto do
// sistema evita. Esses itens ficam sempre na Fila atual, como trabalho da equipe.
import * as F from '../fluxo.js';
import { pacientePor, assumirSolicitacao, liberarSolicitacao, moverSolicitacao, nomeDe, configAtual } from '../dados.js';
import { situacao, explicar, atrasadas } from '../prazos.js';
import { vigiarNovidades, faixaDeNovidades } from '../atualiza.js';
import { dadosDasFilas, filasDoPapel, repartir } from '../filas.js';
import { start, h, run, pageHead, empty, badge, icon, desde, corEtapa, horasNa, confirmDlg } from '../ui.js';
import { PAPEIS } from '../permissoes.js';

const ROOT = new URL('../../', import.meta.url).href;

/**
 * O motor das duas telas. `modo` = 'atual' (o que a equipe ainda não pegou) ou 'minha' (o que é
 * seu). Tudo o mais — as filas, as linhas, o trilho à esquerda — é igual nos dois.
 */
export function telaDeFilas(modo) {
  const meu = modo === 'minha';
  const chave = meu ? 'minhafila/' : 'filas/';
  const titulo = meu ? 'Minha fila' : 'Fila atual';

  return start(chave, titulo, async (ctx, view) => {
  const D = await dadosDasFilas();
  const sols = D.sols;
  const metas = configAtual().metas;
  const papel = ctx.papeis[0];

  // Assinatura barata do que esta tela mostra: cada caso aberto, em que etapa e com quem está.
  // Qualquer passo dado por outro setor muda esta string. Em produção é uma consulta de contagem
  // e `max(atualizado_em)`, não a lista inteira.
  const assinatura = async () => (await dadosDasFilas()).sols
    .filter(F.aberta).map((s) => `${s.id}:${s.etapa}:${s.assumido_por || ''}`).sort().join('|');
  const novidades = faixaDeNovidades(() => location.reload(), { h, icon });
  const vigia = await vigiarNovidades({ assinatura, aoMudar: () => novidades.mostrar() });
  window.addEventListener('pagehide', () => vigia.parar(), { once: true });
  const verPac = ctx.podeCompleto('paciente_identificacao') || ctx.pode('paciente_identificacao');

  // Cada fila repartida conforme a tela: aqui mostramos o que é livre, lá o que é meu.
  const partes = filasDoPapel(papel, D).map((f) => repartir(f, ctx.ator));
  const filas = partes.map((f) => (meu
    ? { ...f, itens: f.meus, assumidos: [], custodia: [] }
    : { ...f, itens: f.livres }));

  // Totais por ITEM DISTINTO, não por soma das filas: o mesmo caso está em mais de uma fila de
  // propósito, e somar os contadores o contaria duas vezes (ver js/filas.js).
  const distintos = (listas) => new Set(listas.flat().map((it) => it.id)).size;
  const total = distintos(filas.map((f) => [...f.itens, ...f.custodia]));
  const assumidosNoTotal = meu ? 0 : distintos(partes.map((f) => f.assumidos));
  let verAssumidos = false;

  async function agir(p, msg) {
    const r = await run(p, msg);
    if (r) location.reload();        // a posse muda as duas filas: a volta ao servidor é honesta
    return r;
  }

  /**
   * O botão de PRÓXIMO PASSO, na própria linha da fila.
   *
   * É o princípio de tela do documento de planejamento: "cada pedido tem um único botão com o
   * próximo passo — isso evita erro e acelera o treinamento". Até aqui era preciso abrir o caso
   * para agir, o que custa dois cliques e uma troca de tela em cada item da fila.
   *
   * Um botão, nunca dois: se a etapa oferece mais de uma saída ao papel (decidir é escolher), a
   * fila não é o lugar de escolher — o botão leva ao caso. Cancelar e reabrir ficam de fora: são
   * exceções, não o próximo passo.
   *
   * Quando o passo precisa de informação (o texto publicado no grupo, o resultado do contato, a
   * decisão clínica, um motivo), o botão ABRE O CASO JÁ NO FORMULÁRIO certo, por `#acao=`. A fila
   * nunca executa pela metade: ou faz o passo inteiro, ou entrega quem clicou no lugar de fazê-lo.
   */
  function proximoPasso(it) {
    if (!F.aberta(it)) return null;
    // `principal` marca o caminho normal do processo em js/fluxo.js. A etapa "Aberta", por
    // exemplo, aceita classificar numa triagem OU pedir o prontuário — duas saídas legítimas,
    // mas só uma é o que acontece sempre. As outras continuam no detalhe, onde há espaço para
    // explicar o que cada uma faz.
    const t = F.transicoesDe(it, ctx.papeis, ctx.ator).find((x) => x.principal);
    if (!t) return null;
    const direto = !t.exigeComunicacao && !t.exigeMotivo && !t.exigeConferencia
      && !['T07', 'T08', 'T12', 'T14'].includes(t.id) && t.para !== 'concluida';
    if (direto) {
      return h('button', {
        class: 'btn sm', type: 'button',
        onclick: () => agir(moverSolicitacao({ id: it.id, transicao: t.id, papeis: ctx.papeis, ator: ctx.ator }),
          `#${it.protocolo}: ${t.rotulo.toLowerCase()}.`),
      }, t.rotulo);
    }
    return h('a', {
      class: 'btn sm',
      href: ROOT + `solicitacoes/detalhe.html?id=${it.id}#acao=${t.id}`,
      title: 'Este passo pede informação: abre o caso já no formulário.',
    }, t.rotulo, '…');
  }

  /** Um item de fila é uma solicitação OU um prontuário: a linha se adapta aos dois. */
  const linha = (it) => {
    if (it.protocolo) {
      const pac = pacientePor(it.paciente_id);
      // O alerta de pedido parado vem da meta da clínica (js/prazos.js), e é na fila que ele
      // precisa aparecer: é a tela que a equipe deixa aberta.
      const sit = situacao(it, metas);
      const dono = it.assumido_por;
      return h('div', { class: 'item' + (sit.estado === 'atrasada' ? ' late' : '') },
        h('div', {},
          h('a', { class: 'id', href: ROOT + `solicitacoes/detalhe.html?id=${it.id}` }, '#' + it.protocolo),
          h('div', { class: 'sub' }, F.TIPO_CURTO[it.tipo], verPac && pac ? ' · ' + pac.nome : '')),
        h('div', { class: 'o' }, F.proximaAcao(it).texto,
          dono && dono !== ctx.ator ? h('div', { class: 'micro muted' }, 'com ' + nomeDe(dono)) : null,
          sit.rotulo ? h('div', { class: 'micro muted' }, explicar(it, metas)) : null),
        h('div', { class: 'st' },
          sit.rotulo ? badge(sit.rotulo, sit.estado === 'atrasada' ? 'crit' : 'warn') : null,
          it.prioridade === 'alta' ? badge('Alta', 'crit') : null,
          badge(F.ETAPAS[it.etapa], corEtapa(it.etapa)),
          h('span', { class: 'age' + (sit.estado === 'atrasada' ? ' tarde' : '') }, desde(it.etapa_desde)),
          !dono
            ? h('button', {
              class: 'btn sm primary', type: 'button',
              onclick: () => agir(assumirSolicitacao({ id: it.id, papeis: ctx.papeis, ator: ctx.ator }),
                `Você assumiu o #${it.protocolo}. Está na sua fila.`),
            }, 'Assumir')
            : dono === ctx.ator
              ? h('button', {
                class: 'btn sm', type: 'button',
                onclick: async () => {
                  if (!await confirmDlg(`Devolver o #${it.protocolo} à fila da equipe? Ele volta a aparecer para qualquer pessoa do seu papel.`)) return;
                  return agir(liberarSolicitacao({ id: it.id, papeis: ctx.papeis, ator: ctx.ator }),
                    `#${it.protocolo} devolvido à fila da equipe.`);
                },
              }, 'Liberar')
              : badge(nomeDe(dono), 'dim'),
          proximoPasso(it)));
    }
    const pac = pacientePor(it.paciente_id);
    const sol = it.solicitacao_id ? sols.find((s) => s.id === it.solicitacao_id) : null;
    return h('div', { class: 'item' },
      h('div', {},
        h('span', { class: 'id' }, it.codigo),
        h('div', { class: 'sub' }, `estante ${it.local_arquivo}${verPac && pac ? ' · ' + pac.nome : ''}`)),
      h('div', { class: 'o' }, sol ? h('span', {}, 'Protocolo ', h('b', {}, '#' + sol.protocolo), ' · ', F.ETAPAS[sol.etapa]) : 'Sem solicitação associada'),
      h('div', { class: 'st' },
        badge(F.LOCAIS[it.local], it.local === 'arquivo' ? 'ok' : it.local === 'nao_localizado' ? 'crit' : 'warn'),
        sol ? h('a', { class: 'btn sm', href: ROOT + `solicitacoes/detalhe.html?id=${sol.id}` }, 'Abrir') : null));
  };

  // A fila aberta por padrão é a primeira que tem trabalho: quem abre a tela já cai no que importa.
  const quanto = (f) => f.itens.length + f.custodia.length;
  let atual = Math.max(0, filas.findIndex(quanto));
  const corpo = h('section', { class: 'panel' });
  const rail = h('div', { class: 'qrail', role: 'tablist', 'aria-label': 'Filas do seu papel' });

  function pintar() {
    rail.replaceChildren(filas.map((f, i) => h('button', {
      class: 'q' + (i === atual ? ' on' : '') + (quanto(f) ? '' : ' vazia'),
      type: 'button', role: 'tab', 'aria-selected': String(i === atual),
      onclick: () => { atual = i; pintar(); },
    },
    h('span', {}, h('span', { class: 't' }, f.titulo), h('span', { class: 'd' }, f.dica)),
    h('span', { class: 'n' }, String(quanto(f))))));

    const f = filas[atual];
    const n = f ? quanto(f) : 0;
    const mostrados = f ? [...f.itens, ...f.custodia, ...(verAssumidos ? f.assumidos : [])] : [];
    corpo.replaceChildren(
      h('div', { class: 'ph' },
        h('div', {}, h('h2', {}, f?.titulo || 'Fila'), h('p', { class: 'micro muted' }, f?.dica || '')),
        badge(`${n} ${n === 1 ? 'item' : 'itens'}`, n ? 'info' : 'dim')),
      h('div', { class: 'pb' }, mostrados.length
        ? mostrados.map(linha)
        : h('p', { class: 'small muted' }, meu
          ? 'Nada seu nesta fila. O que a equipe ainda não pegou está em "Fila atual".'
          : 'Nada livre nesta fila agora. As outras filas do seu papel estão à esquerda.')),
      // O que já tem dono não some: fica a um clique, para a coordenação ver o quadro inteiro
      // sem que o número da fila passe a contar trabalho que já é de alguém.
      !meu && f?.assumidos.length
        ? h('div', { class: 'pb', style: 'border-top:1px solid var(--line)' },
          h('button', {
            class: 'linkbtn', type: 'button',
            onclick: () => { verAssumidos = !verAssumidos; pintar(); },
          }, verAssumidos
            ? 'Ocultar os que já têm dono'
            : `Mostrar os ${f.assumidos.length} que já têm dono`))
        : null);
  }

  const sub = meu
    ? (total
      ? `${total} ${total === 1 ? 'caso é seu' : 'casos são seus'}. Você responde por eles até passarem para a próxima equipe.`
      : 'Você não assumiu nenhum caso. Pegue trabalho em "Fila atual".')
    : (total
      ? `${total} ${total === 1 ? 'item esperando' : 'itens esperando'} alguém assumir${assumidosNoTotal ? `, além de ${assumidosNoTotal} que já ${assumidosNoTotal === 1 ? 'tem dono' : 'têm dono'}` : ''}.`
      : assumidosNoTotal
        ? `Nada solto: os ${assumidosNoTotal} itens do seu papel já têm dono.`
        : 'Nada pendente para o seu papel agora.');

  view.append(
    pageHead(PAPEIS[papel], titulo, sub),
    novidades.el,
    !filas.length
      ? empty('Este papel não participa do fluxo de atendimento. Troque de papel na barra superior para ver as outras filas.')
      : h('div', { class: 'split' }, rail, corpo),
    // Por que o total acima pode ser menor que a soma dos números à esquerda: as filas são
    // leituras diferentes do mesmo trabalho e se cruzam de propósito. O total conta casos, não
    // aparições — sem isso, o mesmo atendimento seria cobrado duas vezes.
    h('p', { class: 'micro muted', style: 'margin-top:20px' }, icon('check'),
      ' Cada fila é um filtro sobre os mesmos registros, e um caso pode aparecer em mais de uma'
      + ' — por isso o total conta casos, não linhas.'
      + (meu ? ' Assumir não trava nada: ao liberar, o caso volta à fila da equipe com o registro de quem o teve.' : '')),
  );
  if (filas.length) pintar();
  });
}

export const init = () => telaDeFilas('atual');
