// Inicializa a página. Cada página declara o módulo e a função em atributos de dado:
//   <script type="module" src="../js/boot.js" data-modulo="solicitacoes" data-fn="init"></script>
//
// Existe por dois motivos: nenhum script embutido (a política de segurança da página não precisa
// liberar script em linha) e só nomes simples, sem barras, são aceitos — assim nada carrega código
// de outro lugar a partir de um atributo.
const tag = document.querySelector('script[data-modulo]');
const modulo = tag?.dataset.modulo || '', fn = tag?.dataset.fn || '';
if (/^[a-z]+$/.test(modulo) && /^(init|initFicha)$/.test(fn)) {
  import(`./modules/${modulo}.js`).then((m) => m[fn]()).catch((e) => {
    console.error(e);
    document.getElementById('app')?.replaceChildren(Object.assign(document.createElement('p'), {
      textContent: 'Não foi possível carregar esta página. Recarregue; se continuar, avise o suporte.',
      style: 'padding:24px;font-family:system-ui',
    }));
  });
}
