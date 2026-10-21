# Prontus

**Solicitações clínicas: da ligação do paciente à receita na mão, com rastro de cada passo.**

Sistema para clínica controlar dois atendimentos que hoje vivem em grupo de WhatsApp e papel:

1. **Dúvida ou correção na receita** — o paciente liga, alguém precisa achar o prontuário, o médico responde, alguém avisa o paciente.
2. **Pedido de receita médica** — o mesmo caminho, mais a emissão e a entrega do documento.

Junto com eles, o sistema controla a **custódia do prontuário físico** (onde está, com quem, desde quando) como uma trilha paralela: concluir o atendimento não é arquivar o prontuário, e o sistema não finge que é.

---

## Estado atual: demonstração funcional

O que está neste repositório é a **vitrine**: o fluxo, as regras, as permissões e todas as telas funcionando de verdade, com **dados fictícios em memória**. Não há servidor, banco, login nem rede — abrir o `index.html` por um servidor estático basta.

Uma faixa no topo diz isso o tempo todo, de propósito, e o botão **Reiniciar dados** devolve tudo ao estado inicial.

**Nenhum dado real de paciente existe aqui.** Tudo é sintético.

### Rodar

```bash
npm run dev      # servidor estático em http://localhost:3000
npm run check    # verificação estática (sintaxe, imports, páginas, segurança, tokens) + paleta
npm run cores    # só a paleta: contraste, daltonismo, etiquetas e rampa, nos dois temas
npm install      # só na primeira vez, para os testes (jsdom)
npm test         # renderiza toda tela com todo papel e exercita os dois fluxos de ponta a ponta
```

### Publicar

Projeto próprio no Cloudflare Workers (`prontus`), endereço próprio, cabeçalhos próprios:

```bash
npm run preview  # endereço de versão, para mostrar sem publicar
npm run deploy   # publica
```

O roteiro de apresentação está em [`docs/roteiro-apresentacao.md`](docs/roteiro-apresentacao.md).

---

## Como está organizado

```
index.html  filas/  minhafila/  solicitacoes/  prontuarios/  registros/  relatorios/  permissoes/
css/     tokens.css (identidade)  base.css (primitivas)  app.css (casca e telas)
js/      marca.js   nome do produto, num lugar só
         fluxo.js   máquina de estados dos dois fluxos — puro, testável
         permissoes.js  matriz papel × recurso × ação — puro, testável
         filas.js   quais filas cada papel tem, e como se repartem entre as duas telas
         tema.js    escuro (padrão) ou claro — só troca um atributo em <html>
         dados.js   ÚNICO arquivo que a ida para produção substitui
         papel.js   quem está usando (na demonstração, um seletor)
         ui.js      casca da aplicação e peças visuais
         base/      peças sem domínio: DOM seguro, modal, tabela, validação
         modules/   uma tela por arquivo
scripts/verificar.mjs  scripts/cores.mjs  tests/telas.mjs
```

**Sem build e sem dependência em produção.** O que é servido é o que está no repositório: HTML, CSS e módulos ES. `jsdom` existe só para o teste.

### A troca para produção

`js/dados.js` guarda tudo em memória e devolve `{ data, error }` como um cliente de banco de verdade, de propósito: as telas usam o mesmo `run()` e **não mudam** quando a origem virar o Postgres. As funções (`moverSolicitacao`, `moverProntuario`, `registrarAvaliacao`…) são o espelho das funções que vão existir no banco.

`js/fluxo.js` e `js/permissoes.js` são puros e espelham o que vai para o SQL. O cabeçalho de cada um diz, em letras garrafais, o que esta demonstração **não** é: regra que só existe no navegador não é regra. Em produção a tabela de transições, a matriz de permissões e a verificação vivem no banco, que recusa com o código `42501` — o navegador só evita mostrar botão que não funcionaria.

---

## Identidade visual

Clínico e denso, em **dois temas**. Quem usa isto passa o dia na tela: a informação é densa, a cor é escassa e sinaliza estado, e a legibilidade vem antes do efeito visual.

**O escuro é o padrão** — a recepção e o arquivo ficam com a tela aberta o dia inteiro, em sala de luz baixa, e superfície escura cansa menos. O claro continua inteiro, a um clique na barra superior, porque sala de luz forte pede o contrário. A escolha fica em `localStorage`: é preferência da pessoa naquele computador, e o terminal abre do mesmo jeito no dia seguinte.

**O papel impresso é sempre claro.** A Recepção imprime a ficha e leva ao médico junto do prontuário; `@media print` redefine os tokens de cor para os valores do tema claro, qualquer que seja o tema da tela.

| | escuro (padrão) | claro |
|---|---|---|
| Papel / superfície | `#0D1417` / `#151E22` | `#F3F5F4` / `#FFFFFF` |
| Tinta | `#EAF0F1` · `#B3C2C7` · `#85959B` | `#101518` · `#49555B` · `#6B7A81` |
| Marca (petróleo) | `#52B4CD` | `#0E4B57` |
| Estados | ok `#1E9A4B` · atenção `#E3A92F` · crítico `#FE6A7B` | ok `#157F4F` · atenção `#B4820A` · crítico `#BC2342` |
| Barras (magnitude) | rampa petróleo `#2A6274` → `#7CC4D8` | `#7EB6C4` → `#115A6B` |

Tipografia e geometria **não mudam** com o tema: Inter Tight (interface), Instrument Serif (assinatura), IBM Plex Mono (códigos e números); raio 3 px em campos e botões, 6 px em painéis; fio de 1 px em vez de sombra; sem brilho, sem desfoque. O monograma é o dossiê e a trilha que a solicitação percorre.

Cada estado tem quatro papéis, e eles não são a mesma cor de propósito: `--ok` é o **sinal** (ponto, barra, número), `--ok-ink` é a **tinta** sobre o fundo da etiqueta, `--ok-wash` o fundo e `--ok-line` a borda. Separar sinal de tinta é o que evita ter de escurecer o sinal só para o texto da etiqueta caber no contraste — foi exatamente isso que fazia o âmbar encostar no crítico na simulação de deuteranopia.

### As cores não foram escolhidas no olho

`npm run cores` valida a paleta **nos dois temas** e falha se algum critério cair:

- **texto**: `--ink` ≥ 7:1, `--ink-2` ≥ 4,5:1, `--ink-3` ≥ 3:1 sobre papel e sobre superfície;
- **estados**: contraste ≥ 3:1 sobre a superfície, ΔE2000 ≥ 15 entre os três na visão normal e ≥ 8 nas simulações de **protanopia, deuteranopia e tritanopia** (Viénot–Brettel–Mollon) — nenhum par se confunde, nem para quem não distingue vermelho de verde;
- **etiquetas**: a tinta tem ≥ 4,5:1 sobre o próprio fundo e mantém o matiz do sinal (≤ 20°), para a etiqueta não trocar de significado;
- **rampa**: um só matiz (variação ≤ 12°), luminosidade monotônica, degraus perceptíveis e ponta visível sobre a superfície.

O script lê `css/tokens.css` diretamente — **não existe uma segunda cópia da paleta** para ficar desencontrada da que o navegador usa. Ele roda dentro de `npm run check`, então um hex novo que quebre um critério derruba a verificação.

Toda cor de estado aparece **com rótulo**: a cor nunca carrega sozinha o significado. A validação acima é a segunda linha de defesa, não a primeira.

Tudo vive em `css/tokens.css`, e a verificação recusa qualquer token usado numa tela que não esteja definido lá — é o que impede uma tela de inventar cor.

### Decisões de layout, para não se perderem

1. **Navegação na barra superior, não em menu lateral.** As telas são cheias de tabela; 256 px de lateral fixa custam uma coluna de dado no monitor da recepção.
2. **Densidade antes de enfeite.** Caixa arredondada com texto solto desperdiça espaço. Indicadores ficam num painel só, dividido por fios, com o critério de contagem embaixo do número.
3. **A fila escolhe-se à esquerda e lê-se à direita.** O formato de uma caixa por fila cortava cada lista em "e mais 12…".
4. **No detalhe, a próxima ação e os botões dela no mesmo bloco.** Ler o que falta e fazer o que falta no mesmo lugar.
5. **Cor é sinal.** Fora das etiquetas de estado e da marca, é tinta sobre papel.
6. **Fila atual e Minha fila são duas telas, não duas abas.** Pegar trabalho e tocar o que já é seu são dois momentos diferentes do dia; o número de cada uma fica no menu, e cada número conta exatamente o que a sua tela mostra.

---

## Quem está com o caso agora

A etapa diz de qual **equipe** é a vez. Isso não bastava: "o Call Center tem 16 itens" não diz quem vai fazer o quê, e dois atendentes podiam pegar o mesmo caso sem saber.

Por isso a solicitação tem dono explícito:

- **Fila atual** — o que é da vez da sua equipe e **ninguém assumiu**. É de onde se pega trabalho, com o botão **Assumir**.
- **Minha fila** — o que **você** assumiu. É a sua lista de responsabilidade, e dela sai o número no menu.
- **Liberar** devolve o caso à fila da equipe, e fica registrado que você o teve.

A posse vale **por etapa**: quando o caso passa para outra equipe ela se desfaz sozinha, porque ninguém continua dono de um trecho que não é mais dele. Quem respondeu por cada trecho fica na linha do tempo — é esse o rastro do começo ao fim. Se a etapa seguinte ainda é da mesma equipe, o dono continua: não se pede para reassumir o que já se está fazendo.

A **trilha do prontuário físico não entra nisso**. A custódia é controlada pelos registros de movimentação, com nome e hora em cada um; misturar os dois eixos é exatamente o que o resto do sistema evita.

**Contagem.** As filas se cruzam de propósito — o mesmo caso está em "Respostas recebidas a conferir" e em "Pacientes a contatar", que são duas leituras do mesmo trabalho. Todo total passa por um conjunto de ids: conta casos, não linhas. Os números do menu e os das telas saem da **mesma função** (`js/filas.js`), e é por isso que não podem divergir.

---

## Especificação

Os códigos `RN-xx`, `RF-xx`, `T-xx` e `C-xx` citados nos comentários do código vêm da especificação escrita do produto (13 documentos: fluxos, regras de negócio, papéis e permissões, modelo de dados, backlog por fases, perguntas abertas).

**Essa especificação não está neste repositório.** Quando for incorporada, o lugar dela é `docs/`. Até lá, a referência executável das regras é o próprio código: `js/fluxo.js` (transições e condições) e `js/permissoes.js` (matriz).

O que falta para ir ao ar é a parte que não dá para demonstrar: as mesmas regras reescritas no banco, onde não podem ser burladas; login com segundo fator; armazenamento privado dos documentos com endereço assinado e auditoria de leitura; backup testado. E sete decisões que só a clínica pode tomar — entre elas as metas de prazo por etapa, que é por isso que o sistema mostra "tempo parado" e **não** inventa um indicador de "atrasada".

---

## Dado pessoal sensível

O sistema trata dado de saúde (LGPD art. 11). A clínica é controladora; quem fornece e opera o sistema é operadora. Consequências que já estão no desenho:

- a matriz de permissões separa **saber que existe um retorno** de **ler o conteúdo clínico**: o Call Center acompanha e comunica sem acessar o texto da avaliação;
- o administrador **não** ganha acesso clínico por ser administrador;
- o suporte técnico do fornecedor não vê dado clínico por padrão;
- a auditoria registra **leitura**, não só alteração;
- em produção, nada de cache compartilhado, nada de indexação, nada de `Referer` para fora — já está no `_headers`.

---

## Produto e fornecedor

Prontus é um produto próprio, com marca, repositório, deploy e identidade próprios. A VEMAX é quem o fornece, vende e dá suporte — o papel "Suporte técnico" na matriz de permissões é dela. Trocar essa relação é editar `js/marca.js`.

---

### Nota sobre o `serve.json`

Ele existe por um motivo só: o padrão do `serve` é redirecionar `/x.html` para `/x`, e esse
redirecionamento **derruba a query string** — `solicitacoes/detalhe.html?id=…` chegaria sem o `id`
e a tela diria "Solicitação não encontrada". Com `cleanUrls: false`, o endereço local fica igual ao
publicado no Cloudflare. O arquivo não vai para o ar (`.assetsignore`).
