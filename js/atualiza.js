// PRONTUS — atualização automática das telas de trabalho.
//
// O plano do projeto define, para o MVP: "a tela consulta novidades a cada 10 a 15 segundos".
// É o que faz a fila valer mais que o grupo do WhatsApp — quem está com a tela aberta vê o
// trabalho chegar sem apertar F5, e ninguém age sobre uma lista velha.
//
// DUAS DECISÕES QUE IMPORTAM MAIS QUE O INTERVALO:
//
// 1. Não redesenhamos a tela por baixo de quem está usando. Puxar a lista no meio de um clique é
//    como o sistema erra sozinho: a linha some, o botão muda de lugar, a pessoa clica no caso
//    errado. Então o ciclo COMPARA e, havendo diferença, mostra uma faixa discreta — quem decide
//    quando atualizar é quem está lendo.
// 2. Para de contar quando a aba não está à vista. Monitor da recepção com dez abas abertas não
//    precisa de dez relógios consultando o servidor.
//
// EM PRODUÇÃO é aqui que entra o tempo real do Supabase (plano oficial) sem mexer nas telas: a
// assinatura passa a vir de um evento em vez de um intervalo, e o resto continua igual.
const INTERVALO_MS = 12000;      // dentro da faixa de 10 a 15 s do plano

/**
 * Vigia novidades e avisa quando houver.
 *
 * `assinatura()` devolve uma string curta que muda quando algo que a tela mostra mudou — contar
 * registros e pegar o carimbo mais recente basta, e é o que uma consulta barata faria no banco.
 * `aoMudar(nova)` é chamado só quando a assinatura difere da que estava na tela.
 *
 * Devolve `{ parar, marcar }`: `marcar()` sincroniza a assinatura depois que a própria tela se
 * atualizou, para a faixa não aparecer por causa de uma mudança que ela mesma acabou de fazer.
 */
export async function vigiarNovidades({ assinatura, aoMudar, intervalo = INTERVALO_MS }) {
  let atual = await assinatura();
  let timer = null;
  let rodando = false;

  const checar = async () => {
    if (document.hidden || rodando) return;     // sem empilhar consultas se uma demorar
    rodando = true;
    try {
      const nova = await assinatura();
      if (nova !== atual) { atual = nova; aoMudar(nova); }
    } finally { rodando = false; }
  };

  // Relógio da JANELA, não do processo: fechar a página o encerra sozinho, inclusive no jsdom
  // dos testes, onde não há "fechar a aba" para disparar o pagehide que chamaria parar().
  const ligar = () => { if (!timer) timer = window.setInterval(checar, intervalo); };
  const desligar = () => { if (timer) { window.clearInterval(timer); timer = null; } };

  const aoTrocarVisibilidade = () => {
    if (document.hidden) { desligar(); return; }
    ligar();
    checar();                    // voltou para a aba: confere na hora, não daqui a 12 s
  };

  document.addEventListener('visibilitychange', aoTrocarVisibilidade);
  ligar();

  return {
    marcar: async () => { atual = await assinatura(); },
    parar: () => { desligar(); document.removeEventListener('visibilitychange', aoTrocarVisibilidade); },
  };
}

/**
 * A faixa que aparece quando há novidade. Discreta e fixa no topo do conteúdo: avisa sem empurrar
 * a página e sem roubar o clique de quem está no meio de uma ação.
 */
export function faixaDeNovidades(aoAtualizar, { h, icon }) {
  const faixa = h('div', { class: 'novidades', role: 'status', hidden: '' });
  faixa.replaceChildren(
    h('span', {}, icon('refresh'), ' A fila mudou desde que esta tela foi aberta.'),
    h('button', { class: 'btn sm', type: 'button', onclick: aoAtualizar }, 'Atualizar'));
  return {
    el: faixa,
    mostrar: () => { faixa.hidden = false; },
    esconder: () => { faixa.hidden = true; },
  };
}
