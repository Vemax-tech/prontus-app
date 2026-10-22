// Inicializa a página. Cada página declara o módulo e a função em atributos de dado:
//   <script type="module" src="../js/boot.js" data-modulo="solicitacoes" data-fn="init"></script>
//
// Existe por dois motivos: nenhum script embutido (a política de segurança da página não precisa
// liberar script em linha) e só nomes simples, sem barras, são aceitos — assim nada carrega código
// de outro lugar a partir de um atributo.
// O tema vem primeiro, antes de montar qualquer coisa: trocar a cor depois da tela desenhada
// é o que produz o clarão. O escuro é o padrão do CSS, então na prática isto só age para quem
// escolheu o claro.
import { aplicarTema } from './tema.js';
import { exigirSessao } from './auth.js';

aplicarTema();

const tag = document.querySelector('script[data-modulo]');
const modulo = tag?.dataset.modulo || '', fn = tag?.dataset.fn || '';
if (/^[a-z]+$/.test(modulo) && /^(init|initFicha)$/.test(fn)) {
  // Toda tela, menos a de entrada, só carrega com sessão válida: sem ela a pessoa vai para o login
  // e volta para onde estava. A tela de login cuida sozinha de quem já entrou.
  (modulo === 'login' ? Promise.resolve(true) : exigirSessao())
    .then((liberado) => liberado && import(`./modules/${modulo}.js`).then((m) => m[fn]()))
    .catch((e) => {
    console.error(e);
    document.getElementById('app')?.replaceChildren(Object.assign(document.createElement('p'), {
      textContent: 'Não foi possível carregar esta página. Recarregue; se continuar, avise o suporte.',
      style: 'padding:24px;font-family:system-ui',
    }));
  });
}
