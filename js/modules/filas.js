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
// sistema evita. Esses itens ficam sempre na Fila da equipe, como trabalho da equipe.
import * as F from '../fluxo.js';
import {
  pacientePor, assumirSolicitacao, liberarSolicitacao, moverSolicitacao, moverProntuario,
  nomeDe, configAtual,
} from '../dados.js';
import { situacao, explicar } from '../prazos.js';
import { vigiarNovidades, faixaDeNovidades } from '../atualiza.js';
import { dadosDasFilas, filasDoPapel, repartir, proximoCaso } from '../filas.js';
import {
  start, h, run, pageHead, empty, badge, icon, desde, corEtapa, confirmDlg, modal, toast,
  botaoOcupado, linhaExpansivel, peekCampo, fmtDate,
} from '../ui.js';
import { PAPEIS } from '../permissoes.js';

const ROOT = new URL('../../', import.meta.url).href;

/**
 * O motor das duas telas. `modo` = 'atual' (o que a equipe ainda não pegou) ou 'minha' (o que é
 * seu). Tudo o mais — as filas, as linhas, o trilho à esquerda — é igual nos dois.
 */
export function telaDeFilas(modo) {
  const meu = modo === 'minha';
  const chave = meu ? 'minhafila/' : 'filas/';
  const titulo = meu ? 'Meus casos' : 'Fila da equipe';

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

  // O que está aberto e o que foi digitado no filtro vivem FORA do pintar(): toda ação redesenha
  // a lista, e sem isso a linha que a pessoa acabou de abrir se fecharia no clique seguinte.
  const abertos = new Set();
  let busca = '';

  // ---------------------------------------------------------------- trabalho em lote
  //
  // O ARQUIVO NÃO TRABALHA UM A UM. Quem vai à estante volta com doze pastas de uma vez; o
  // sistema obrigava doze idas à tela — abrir o caso, registrar, voltar, procurar o próximo. A
  // fila JÁ É a lista das doze: marcar e aplicar de uma vez é o gesto que já acontece no mundo.
  //
  // O lote só aparece quando TODOS os itens visíveis têm O MESMO próximo passo. Lote de passos
  // diferentes é exatamente como alguém registraria "entregue" numa pasta que nem foi localizada
  // — e a regra que impede isso não pode depender de a pessoa reparar.
  const selecionados = new Set();
  let loteAtual = null;
  let mostradosAgora = [];

  const passoEmLote = (mostrados) => {
    // Linha sem passo nenhum não atrapalha o lote: ela simplesmente não entra. O que impede o
    // lote é haver DOIS passos diferentes à vista, ou um passo que peça formulário — ninguém
    // transcreve dez retornos do médico de uma vez.
    const passos = mostrados.map(passoDaLinha).filter(Boolean);
    if (passos.length < 2 || passos.some((p) => p.tipo === 'form')) return null;
    return passos.every((p) => p.chave === passos[0].chave) ? passos[0] : null;
  };

  /** Os itens à vista a que o lote se aplica — os outros ficam na lista, sem caixa de seleção. */
  const elegiveis = (mostrados) => (loteAtual
    ? mostrados.filter((it) => passoDaLinha(it)?.chave === loteAtual.chave) : []);

  /**
   * O CAMPO DO LEITOR DE CÓDIGO DE BARRAS.
   *
   * Não há integração nenhuma a fazer: um leitor USB é um teclado que digita muito rápido e
   * aperta Enter no fim. Toda a "integração" é este campo focado e a busca pelo código. Quem tem
   * leitor bipa a etiqueta de cada pasta que separou; quem não tem digita o código. O resultado é
   * o mesmo: a linha certa marcada, sem procurar na lista.
   */
  const campoBipe = h('input', {
    type: 'search', class: 'bipe', placeholder: 'Bipar ou digitar o código da pasta…',
    'aria-label': 'Código do prontuário — funciona com leitor de código de barras',
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); bipar(e.currentTarget); } },
  });

  function bipar(el) {
    const codigo = el.value.trim();
    if (!codigo) return;
    el.value = '';
    const achado = mostradosAgora.find((it) => {
      const pront = it.codigo ? it : D.pronts.find((p) => p.id === it.prontuario_id);
      return pront?.codigo?.toLowerCase() === codigo.toLowerCase() || String(it.protocolo) === codigo;
    });
    if (!achado) { toast(`"${codigo}" não está nesta fila. Confira o código, ou a fila à esquerda.`, true); return; }
    selecionados.add(achado.id);
    pintarLista();
    el.focus();                                     // a próxima pasta já vem; o cursor fica onde está
    toast(`${codigo} marcado — ${selecionados.size} na seleção.`);
  }

  /**
   * Aplica o passo a cada selecionado, UM A UM e na ordem. Não existe "tudo ou nada" aqui: o
   * servidor valida cada registro isoladamente, e o que falhar não pode desfazer o que já deu
   * certo. O que não passou é listado com o motivo, caso a caso — um lote que falha em silêncio
   * é pior que nenhum lote.
   */
  async function aplicarEmLote(passo, itens) {
    const falhas = [];
    let feitos = 0;
    for (const it of itens) {
      const { error } = await executarPasso(it, passo);
      if (error) falhas.push(`#${it.protocolo}: ${error.message}`); else feitos += 1;
    }
    if (falhas.length) {
      modal('O lote passou só em parte', h('div', {},
        h('p', {}, `${feitos} de ${itens.length} registrados. Estes não passaram:`),
        h('ul', { class: 'ul-list', style: 'margin:12px 0' }, falhas.map((f) => h('li', {}, f))),
        h('p', { class: 'small muted' }, 'O que passou está salvo. Os de cima continuam na fila.')),
      (close) => h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { close(); location.reload(); } }, 'Entendi')));
      return;
    }
    toast(`${feitos} ${feitos === 1 ? 'registro feito' : 'registros feitos'} de uma vez.`);
    location.reload();
  }

  const barraLote = h('div', { class: 'lote', hidden: '' });

  function pintarLote(mostrados) {
    barraLote.hidden = !loteAtual;
    if (!loteAtual) return;
    const aplicaveis = elegiveis(mostrados);
    const marcados = aplicaveis.filter((it) => selecionados.has(it.id));
    const todos = marcados.length === aplicaveis.length;
    barraLote.replaceChildren(
      h('div', { class: 'row' },
        h('button', {
          class: 'linkbtn', type: 'button',
          onclick: () => {
            aplicaveis.forEach((it) => (todos ? selecionados.delete(it.id) : selecionados.add(it.id)));
            pintarLista();
          },
        }, todos ? 'Desmarcar todos' : `Marcar os ${aplicaveis.length}`),
        campoBipe),
      h('div', { class: 'row' },
        h('span', { class: 'micro muted' }, marcados.length
          ? `${marcados.length} de ${aplicaveis.length} selecionado${marcados.length > 1 ? 's' : ''}`
          : 'Marque as linhas, ou bipe o código de cada pasta que você separou.'),
        botaoOcupado(`${loteAtual.rotulo} · ${marcados.length}`,
          () => aplicarEmLote(loteAtual, marcados),
          { class: 'btn sm primary', disabled: marcados.length ? null : '' })));
  }

  // Cada fila repartida conforme a tela: aqui mostramos o que é livre, lá o que é meu.
  const partes = filasDoPapel(papel, D).map((f) => repartir(f, ctx.ator, papel));
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

  /** O texto em que o filtro rápido procura: protocolo, tipo, etapa, paciente e próxima ação. */
  const procuravel = (it) => {
    if (!it.protocolo) {
      const pac = pacientePor(it.paciente_id);
      return [it.codigo, it.local_arquivo, F.LOCAIS[it.local], verPac && pac ? pac.nome : ''].join(' ').toLowerCase();
    }
    const pac = pacientePor(it.paciente_id);
    return [it.protocolo, F.TIPO_CURTO[it.tipo], F.ETAPAS[it.etapa], F.proximaAcao(it).texto,
      verPac && pac ? pac.nome : '', it.assumido_por ? nomeDe(it.assumido_por) : ''].join(' ').toLowerCase();
  };
  const passaNoFiltro = (it) => !busca || procuravel(it).includes(busca.toLowerCase());

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
    const p = passoDaLinha(it);
    if (!p) return null;
    if (p.tipo === 'form') return botaoDeTransicao(it, p.t);
    return botaoOcupado(p.rotulo, () => agir(executarPasso(it, p), `#${it.protocolo}: ${p.rotulo.toLowerCase()}.`),
      { class: 'btn sm' });
  }

  /**
   * QUAL É, DE VERDADE, O PRÓXIMO PASSO DESTA LINHA — nos dois eixos.
   *
   * `principal` marca o caminho normal do processo em js/fluxo.js. A etapa "Aberta", por exemplo,
   * aceita classificar numa triagem OU pedir o prontuário — duas saídas legítimas, mas só uma é o
   * que acontece sempre; as outras aparecem ao abrir a linha, onde há espaço para explicá-las.
   *
   * Só que a etapa da solicitação não é a história inteira. Para o ARQUIVO, o passo quase sempre
   * é um registro de custódia (localizou, retirou), e a transição da solicitação só vem no fim.
   * Oferecer "Entregar à Recepção" a uma pasta que ninguém achou ainda é oferecer um botão que o
   * sistema vai recusar — e o botão recusado é o que ensina a equipe a desconfiar da tela.
   */
  function passoDaLinha(it) {
    if (!it.protocolo || !F.aberta(it)) return null;
    const t = F.transicoesDe(it, ctx.papeis).find((x) => x.principal);
    const mov = custodiaQueFalta(it, t);
    if (mov === 'nada') return null;
    if (mov) return { tipo: 'mov', chave: 'mov:' + mov.mov, rotulo: mov.rotulo, mov };
    if (!t) return null;
    const pedeFormulario = t.exigeComunicacao || t.exigeMotivo || t.exigeConferencia || t.exigeMedico
      || ['T07', 'T08', 'T12', 'T14'].includes(t.id) || t.para === 'concluida';
    return { tipo: pedeFormulario ? 'form' : 'trans', chave: 't:' + t.id, rotulo: t.rotulo, t };
  }

  /**
   * O eixo da PASTA, quando o passo da solicitação depende dele.
   *
   * Três respostas possíveis, e as três importam:
   *   · `{ mov }`  — falta um registro de custódia antes (localizar antes de retirar);
   *   · `null`     — a pasta está em dia, ou o próprio passo já a leva junto (js/dados.js);
   *   · `'nada'`   — a pasta está num lugar de onde este papel não a move. Aí o passo da
   *                  solicitação também não vai passar, e oferecer o botão seria oferecer uma
   *                  recusa. Acontece, por exemplo, quando duas solicitações abertas disputam o
   *                  mesmo prontuário: raro, mas o botão que sempre falha é o que ensina a
   *                  equipe a desconfiar da tela inteira.
   */
  function custodiaQueFalta(it, t) {
    if (!t?.viaProntuario) return null;
    const pront = D.pronts.find((p) => p.id === it.prontuario_id);
    if (!pront) return null;
    const feitos = D.movimentos.filter((m) => m.solicitacao_id === it.id).map((m) => m.tipo);
    if (feitos.includes(t.viaProntuario)) return null;
    const possiveis = F.movimentosDe(pront, ctx.papeis, feitos);
    if (possiveis.some((m) => m.mov === t.viaProntuario)) return null;
    return possiveis[0] || 'nada';
  }

  const executarPasso = (it, p) => (p.tipo === 'mov'
    ? moverProntuario({ prontuario_id: it.prontuario_id, mov: p.mov.mov, papeis: ctx.papeis, ator: ctx.ator, solicitacao_id: it.id })
    : moverSolicitacao({ id: it.id, transicao: p.t.id, papeis: ctx.papeis, ator: ctx.ator }));

  /**
   * Um passo do fluxo como botão. Quando o passo precisa de informação, ele NÃO vira um botão que
   * faz meio passo: vira um link que abre o caso já no formulário certo, por `#acao=`.
   */
  function botaoDeTransicao(it, t) {
    const direto = !t.exigeComunicacao && !t.exigeMotivo && !t.exigeConferencia && !t.exigeMedico
      && !['T07', 'T08', 'T12', 'T14'].includes(t.id) && t.para !== 'concluida';
    if (direto) {
      return botaoOcupado(t.rotulo, () => agir(
        moverSolicitacao({ id: it.id, transicao: t.id, papeis: ctx.papeis, ator: ctx.ator }),
        `#${it.protocolo}: ${t.rotulo.toLowerCase()}.`),
      { class: 'btn sm' + (t.id === 'T15' ? ' danger' : '') });
    }
    return h('a', {
      class: 'btn sm' + (t.id === 'T15' ? ' danger' : ''),
      href: ROOT + `solicitacoes/detalhe.html?id=${it.id}#acao=${t.id}`,
      title: 'Este passo pede informação: abre o caso já no formulário.',
    }, t.rotulo, '…');
  }

  /**
   * O detalhe que abre na própria linha: de quem é o caso, o que o paciente pediu, onde está a
   * pasta, e TODAS as ações do papel — não só a principal. É o lugar que o comentário do
   * "um botão, nunca dois" prometia: as outras saídas existem, mas longe do clique de volume.
   */
  function corpoDoCaso(it) {
    const pac = pacientePor(it.paciente_id);
    const pront = D.pronts.find((p) => p.id === it.prontuario_id);
    const prox = F.proximaAcao(it);
    const trans = F.transicoesDe(it, ctx.papeis);
    const outras = trans.filter((t) => !t.principal);
    return h('div', {},
      h('div', { class: 'pks' },
        peekCampo('Paciente', verPac && pac
          ? h('span', {}, pac.nome, h('div', { class: 'micro muted' }, `nasc. ${fmtDate(pac.nascimento)} · ${pac.telefone}`))
          : h('span', { class: 'muted' }, 'reduzido para o seu papel')),
        peekCampo('Prontuário', pront
          ? h('span', { class: 'mono' }, pront.codigo, h('div', { class: 'micro muted' }, `${F.LOCAIS[pront.local]} · estante ${pront.local_arquivo}`))
          : null),
        peekCampo('Próxima ação', h('span', {}, prox.texto,
          h('div', { class: 'micro muted' }, prox.papel ? 'responsável: ' + prox.papel : 'caso encerrado'))),
        peekCampo('Com quem está', it.assumido_por
          ? h('span', {}, nomeDe(it.assumido_por), it.assumido_por === ctx.ator ? h('div', { class: 'micro', style: 'color:var(--ok)' }, 'é você') : null)
          : h('span', { class: 'muted' }, 'ninguém ainda')),
        it.medico_nome ? peekCampo('Médico', h('span', {}, it.medico_nome, h('div', { class: 'micro muted' }, 'fora do sistema'))) : null),
      h('div', { class: 'acts' },
        h('a', { class: 'btn sm', href: ROOT + `solicitacoes/detalhe.html?id=${it.id}` }, icon('arrow'), 'Abrir o caso'),
        outras.map((t) => botaoDeTransicao(it, t)),
        !trans.length ? h('span', { class: 'small muted' }, 'Nenhuma ação sua nesta etapa.') : null));
  }

  /** O mesmo, para a pasta física: a trilha dela, que não tem protocolo nem dono. */
  function corpoDoProntuario(it) {
    const pac = pacientePor(it.paciente_id);
    const movs = D.movimentos.filter((m) => m.prontuario_id === it.id).slice(-6).reverse();
    return h('div', {},
      h('div', { class: 'pks' },
        peekCampo('Paciente', verPac && pac ? pac.nome : h('span', { class: 'muted' }, 'reduzido para o seu papel')),
        peekCampo('Onde está', h('span', {}, F.LOCAIS[it.local], h('div', { class: 'micro muted' }, 'estante ' + it.local_arquivo))),
        peekCampo('Com quem', nomeDe(it.custodia_usuario_id))),
      movs.length
        ? h('ul', { class: 'tl' }, movs.map((m) => h('li', {},
          h('div', { class: 'row between' }, h('b', {}, F.MOVIMENTOS[m.tipo]), h('span', { class: 'when' }, desde(m.criado_em))),
          h('p', { class: 'micro muted' }, nomeDe(m.ator_id), m.nota ? ' · ' + m.nota : ''))))
        : h('p', { class: 'small muted' }, 'Nenhuma movimentação registrada.'));
  }

  /** Um item de fila é uma solicitação OU um prontuário: a linha se adapta aos dois. */
  const linha = (it) => linhaExpansivel({
    id: it.id,
    abertos,
    montarLinha: (gatilho) => montarLinha(it, gatilho),
    montarCorpo: () => (it.protocolo ? corpoDoCaso(it) : corpoDoProntuario(it)),
    rotulo: it.protocolo ? `Ver o caso #${it.protocolo} sem sair da fila` : `Ver a trilha do prontuário ${it.codigo}`,
  });

  const montarLinha = (it, gatilho) => {
    if (it.protocolo) {
      const pac = pacientePor(it.paciente_id);
      // O alerta de pedido parado vem da meta da clínica (js/prazos.js), e é na fila que ele
      // precisa aparecer: é a tela que a equipe deixa aberta.
      const sit = situacao(it, metas);
      const dono = it.assumido_por;
      const pront = D.pronts.find((p) => p.id === it.prontuario_id);
      return h('div', { class: 'item' + (sit.estado === 'atrasada' ? ' late' : '') },
        h('div', { class: 'ident' },
          loteAtual && passoDaLinha(it)?.chave === loteAtual.chave ? h('input', {
            type: 'checkbox', class: 'lotechk',
            'aria-label': `Incluir o caso #${it.protocolo} no lote`,
            checked: selecionados.has(it.id) ? '' : null,
            onclick: (e) => {
              e.stopPropagation();
              if (e.currentTarget.checked) selecionados.add(it.id); else selecionados.delete(it.id);
              pintarLote(mostradosAgora);
            },
          }) : null,
          h('span', {},
            h('a', { class: 'id', href: ROOT + `solicitacoes/detalhe.html?id=${it.id}` }, '#' + it.protocolo),
            // O código da pasta na própria linha: é por ele que o Arquivo procura na estante, e
            // é ele que o leitor de código de barras devolve.
            h('div', { class: 'sub' }, F.TIPO_CURTO[it.tipo],
              pront ? h('span', { class: 'mono' }, ' · ' + pront.codigo) : null,
              verPac && pac ? ' · ' + pac.nome : ''))),
        h('div', { class: 'o' }, F.proximaAcao(it).texto,
          dono && dono !== ctx.ator ? h('div', { class: 'micro muted' }, 'com ' + nomeDe(dono)) : null,
          sit.rotulo ? h('div', { class: 'micro muted' }, explicar(it, metas)) : null),
        h('div', { class: 'st' },
          sit.rotulo ? badge(sit.rotulo, sit.estado === 'atrasada' ? 'crit' : 'warn') : null,
          it.prioridade === 'alta' ? badge('Alta', 'crit') : null,
          badge(F.ETAPAS[it.etapa], corEtapa(it.etapa)),
          h('span', { class: 'age' + (sit.estado === 'atrasada' ? ' tarde' : '') }, desde(it.etapa_desde)),
          !dono
            ? botaoOcupado('Assumir', () => agir(
              assumirSolicitacao({ id: it.id, papeis: ctx.papeis, ator: ctx.ator }),
              `Você assumiu o #${it.protocolo}. Está na sua fila.`), { class: 'btn sm primary' })
            : dono === ctx.ator
              ? botaoOcupado('Liberar', async () => {
                if (!await confirmDlg(`Devolver o #${it.protocolo} à fila da equipe? Ele volta a aparecer para qualquer pessoa do seu papel.`)) return;
                return agir(liberarSolicitacao({ id: it.id, papeis: ctx.papeis, ator: ctx.ator }),
                  `#${it.protocolo} devolvido à fila da equipe.`);
              }, { class: 'btn sm' })
              : badge(nomeDe(dono), 'dim'),
          proximoPasso(it),
          gatilho));
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
        sol ? h('a', { class: 'btn sm', href: ROOT + `solicitacoes/detalhe.html?id=${sol.id}` }, 'Abrir') : null,
        gatilho));
  };

  // A fila aberta por padrão é a primeira que tem trabalho: quem abre a tela já cai no que importa.
  const quanto = (f) => f.itens.length + f.custodia.length;
  let atual = Math.max(0, filas.findIndex(quanto));
  const corpo = h('section', { class: 'panel' });
  const rail = h('div', {
    class: 'qrail', role: 'tablist', 'aria-label': 'Filas do seu papel',
    // Um trilho de abas se percorre com as setas, não com dezesseis Tabs. Home e End vão às pontas.
    onkeydown: (e) => {
      const passo = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      const destino = passo ? (atual + passo + filas.length) % filas.length
        : e.key === 'Home' ? 0 : e.key === 'End' ? filas.length - 1 : null;
      if (destino == null) return;
      e.preventDefault();
      atual = destino; pintar();
      rail.children[atual]?.focus();
    },
  });

  // O filtro rápido. Numa fila de dezesseis itens, achar "o caso da dona Terezinha" era rolar e
  // ler; aqui são quatro letras. `/` é o atalho porque é onde a mão já está, e porque toda tela
  // de lista que a equipe usa fora daqui (navegador, chat) usa o mesmo.
  const campoBusca = h('input', {
    type: 'search', placeholder: 'Filtrar nesta fila…', 'aria-label': 'Filtrar os itens desta fila',
    value: busca,
    // Só a LISTA é redesenhada a cada tecla, nunca o painel inteiro: trocar o campo de lugar no
    // meio da digitação tira o foco dele e a pessoa perde a frase na segunda letra.
    oninput: (e) => { busca = e.target.value.trim(); pintarLista(); },
    onkeydown: (e) => { if (e.key === 'Escape') { busca = ''; e.target.value = ''; pintarLista(); e.target.blur(); } },
  });
  const contagemBusca = h('span', { class: 'cnt' });
  const listaEl = h('div', { class: 'qlista' });

  const atalhoBusca = (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    // Nem dentro de um campo nem com uma janela modal aberta: ali a barra é uma barra.
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
    if (document.querySelector('.ov')) return;
    e.preventDefault();
    campoBusca.focus();
    campoBusca.select();
  };
  document.addEventListener('keydown', atalhoBusca);
  window.addEventListener('pagehide', () => document.removeEventListener('keydown', atalhoBusca), { once: true });

  function pintar() {
    rail.replaceChildren(filas.map((f, i) => h('button', {
      class: 'q' + (i === atual ? ' on' : '') + (quanto(f) ? '' : ' vazia'),
      type: 'button', role: 'tab', 'aria-selected': String(i === atual), tabindex: i === atual ? '0' : '-1',
      onclick: () => { atual = i; pintar(); },
    },
    h('span', {}, h('span', { class: 't' }, f.titulo), h('span', { class: 'd' }, f.dica)),
    h('span', { class: 'n' }, String(quanto(f))))));

    const f = filas[atual];
    const n = f ? quanto(f) : 0;
    corpo.replaceChildren(
      h('div', { class: 'ph' },
        h('div', {}, h('h2', {}, f?.titulo || 'Fila'), h('p', { class: 'micro muted' }, f?.dica || '')),
        badge(`${n} ${n === 1 ? 'item' : 'itens'}`, n ? 'info' : 'dim')),
      h('div', { class: 'pb' },
        itensDaVez().length
          ? h('div', { class: 'qfind' }, campoBusca, h('span', { class: 'kbd' }, '/'), contagemBusca)
          : null,
        barraLote,
        listaEl),
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
    pintarLista();
  }

  /** O que a fila escolhida mostra agora, antes do filtro. */
  function itensDaVez() {
    const f = filas[atual];
    return f ? [...f.itens, ...f.custodia, ...(verAssumidos ? f.assumidos : [])] : [];
  }

  function pintarLista() {
    const todos = itensDaVez();
    const mostrados = todos.filter(passaNoFiltro);
    mostradosAgora = mostrados;
    loteAtual = passoEmLote(mostrados);
    // Seleção vale só para o que está à vista: filtrar e depois aplicar a um item escondido é o
    // jeito mais fácil de um lote registrar o que ninguém mandou.
    [...selecionados].forEach((id) => { if (!mostrados.some((it) => it.id === id)) selecionados.delete(id); });
    contagemBusca.textContent = busca ? `${mostrados.length} de ${todos.length}` : '';
    listaEl.replaceChildren(mostrados.length
      ? mostrados.map(linha)
      : h('p', { class: 'small muted' }, busca
        ? `Nenhum item desta fila casa com "${busca}". Esc limpa o filtro.`
        : meu
          ? 'Nada seu nesta fila. O que a equipe ainda não pegou está em "Fila da equipe".'
          : 'Nada livre nesta fila agora. As outras filas do seu papel estão à esquerda.'));
    pintarLote(mostrados);
  }

  const sub = meu
    ? (total
      ? `${total} ${total === 1 ? 'caso é seu' : 'casos são seus'}. Você responde por eles até passarem para a próxima equipe.`
      : 'Você não assumiu nenhum caso. Pegue trabalho em "Fila da equipe".')
    : (total
      ? `${total} ${total === 1 ? 'item esperando' : 'itens esperando'} alguém assumir${assumidosNoTotal ? `, além de ${assumidosNoTotal} que já ${assumidosNoTotal === 1 ? 'tem dono' : 'têm dono'}` : ''}.`
      : assumidosNoTotal
        ? `Nada solto: os ${assumidosNoTotal} itens do seu papel já têm dono.`
        : 'Nada pendente para o seu papel agora.');

  /**
   * "PRÓXIMO CASO" — um clique no lugar de ler a fila inteira.
   *
   * Quem atende em série não quer escolher, quer o próximo. Escolher custa percorrer a lista, e
   * percorrê-la várias vezes por hora é como o caso urgente fica para trás enquanto alguém
   * resolve três fáceis. A ordem está em js/filas.js, onde dá para discuti-la e testá-la.
   */
  function botaoProximoCaso() {
    const alvo = proximoCaso(papel, ctx.ator, D, metas);
    if (!alvo) return null;
    const sit = situacao(alvo, metas);
    return h('a', {
      class: 'btn primary',
      href: ROOT + `solicitacoes/detalhe.html?id=${alvo.id}`,
      title: `#${alvo.protocolo} — ${F.proximaAcao(alvo).texto}`,
    }, icon('arrow'), `Próximo caso · #${alvo.protocolo}`,
    sit.estado === 'atrasada' ? badge('atrasado', 'crit') : null);
  }

  view.append(
    pageHead(PAPEIS[papel], titulo, sub, botaoProximoCaso()),
    novidades.el,
    !filas.length
      ? empty('Este papel não tem fila: ele acompanha o trabalho em vez de executá-lo. A visão dele é a Visão geral, a lista de solicitações e os relatórios.')
      : h('div', { class: 'split' }, rail, corpo),
    // Por que o total acima pode ser menor que a soma dos números à esquerda: as filas são
    // leituras diferentes do mesmo trabalho e se cruzam de propósito. O total conta casos, não
    // aparições — sem isso, o mesmo atendimento seria cobrado duas vezes.
    h('p', { class: 'micro muted', style: 'margin-top:20px' }, icon('olho'),
      ' Clique numa linha para ver o caso sem sair da fila: paciente, pedido, prontuário e as ações'
      + ' que não cabem no botão principal. ', h('b', {}, '/'), ' foca o filtro, ', h('b', {}, 'Esc'),
      ' limpa, e as setas percorrem as filas à esquerda.'),
    h('p', { class: 'micro muted', style: 'margin-top:8px' }, icon('check'),
      ' Cada fila é um filtro sobre os mesmos registros, e um caso pode aparecer em mais de uma'
      + ' — por isso o total conta casos, não linhas.'
      + (meu ? ' Assumir não trava nada: ao liberar, o caso volta à fila da equipe com o registro de quem o teve.' : '')),
  );
  if (filas.length) pintar();
  });
}

export const init = () => telaDeFilas('atual');
