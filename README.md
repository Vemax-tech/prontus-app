# Prontus

**Solicitações clínicas: da ligação do paciente à receita na mão, com rastro de cada passo.**

Sistema para clínica controlar dois atendimentos que hoje vivem em grupo de WhatsApp e papel:

1. **Dúvida ou correção na receita** — o paciente liga, alguém precisa achar o prontuário, o médico responde, alguém avisa o paciente.
2. **Pedido de receita médica** — o mesmo caminho, mais a emissão e a entrega do documento.

Quem usa o sistema são **quatro papéis**: Call Center, Arquivo, Recepção e Administrador. O **médico não é usuário** — ele continua no processo, mas pelo papel, como hoje. Ver [Quatro papéis, quatro fluxos](#quatro-papéis-quatro-fluxos).

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
index.html  filas/  minhafila/  solicitacoes/  prontuarios/  registros/  relatorios/  usuarios/  permissoes/  configuracoes/
css/     tokens.css (identidade)  base.css (primitivas)  app.css (casca e telas)
js/      marca.js   nome do produto, num lugar só
         fluxo.js   máquina de estados dos dois fluxos — puro, testável
         permissoes.js  matriz papel × recurso × ação — puro, testável
         filas.js   quais filas cada papel tem, e como se repartem entre as duas telas
         prazos.js  metas por etapa e o alerta de pedido parado — puro, testável
         atualiza.js a fila conferindo novidades sozinha, sem redesenhar por baixo de quem usa
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

## Quatro papéis, quatro fluxos

Cada papel é um fluxo de trabalho diferente, e a interface inteira obedece a isso: a barra de navegação, a tela inicial, as filas e os botões saem todos da matriz de `js/permissoes.js`. Ninguém precisa aprender a ignorar menu.

| Papel | O que faz | O que vê ao entrar |
|---|---|---|
| **Call Center** | Abre o pedido do paciente e fecha o contato no fim. | "A sua vez": as filas dele, o que ele assumiu, o que passou da meta na etapa dele. |
| **Arquivo** | Localiza, entrega e arquiva o prontuário físico. | O mesmo formato, com as filas de custódia. Sem relatório, sem administração. |
| **Recepção** | A ponte com o consultório: recebe o prontuário, leva o caso ao médico e **registra o retorno dele**. | O mesmo formato. É o único papel que lê conteúdo clínico. |
| **Administrador** | Cria e desativa pessoas, define as regras da clínica, tira relatórios, acompanha tudo. | O painel inteiro: todos os indicadores, equipe, tempos, auditoria. **Não tem fila.** |

**O Administrador não tem fila de propósito.** Dar fila a quem coordena mistura quem cobra com quem é cobrado; ele acompanha pela Visão geral, pela lista de solicitações e pelos relatórios. E, apesar de ser o super usuário, **não lê conteúdo clínico**: coordenar não é motivo clínico.

### O médico saiu do sistema — e continua no processo

O médico **não entra, não tem fila e não tem senha**. O que acontece é o que já acontece hoje: a Recepção imprime a ficha do caso, leva ao consultório junto do prontuário, e volta com a resposta.

O que mudou no sistema:

- a etapa chama-se **"Com o médico"** — ela descreve onde o caso **está**, não quem vai clicar. Nos dois lados dela quem age é a Recepção;
- ao levar, a Recepção diz **a quem** levou, escolhendo da lista de médicos da clínica (mantida pela administração em **Configurações**). Sem isso o sistema não saberia com quem o caso está;
- ao voltar, a Recepção transcreve a decisão, e o registro sai **assinado duas vezes**: nome e CRM de quem decidiu, mais o id de quem digitou. É o que permite à auditoria responder tanto "quem decidiu" quanto "quem registrou";
- a meta de **2 h com o médico**, que veio do plano, continua valendo e medindo exatamente a mesma coisa: o caso saiu da Recepção e ainda não voltou.

### Usuários

A tela **Usuários** é só do Administrador, e é a razão de o papel existir: dar e tirar acesso sem abrir chamado com o fornecedor. Três regras moldam a parte difícil:

1. **Um papel por pessoa** — é o papel que decide quais telas ela vê e qual fila é dela.
2. **Quem já agiu é desativado, não apagado.** Apagar o id de quem assumiu um caso deixaria "—" no lugar da autoria, e a linha do tempo de um registro de saúde não pode perder isso. Só quem nunca agiu some de verdade — e a tela diz, depois do clique, qual dos dois aconteceu.
3. **Ninguém fica sem administrador.** Rebaixar ou desativar o último admin trancaria a clínica para fora da própria administração: a camada de dados recusa.

---

## O que o sistema faz sozinho

O documento de planejamento do projeto pede, já no MVP, quatro coisas que dependem do sistema agir em vez de esperar alguém lembrar. Elas estão aqui:

**Alerta de pedido parado.** Cada etapa tem uma meta de prazo. Passou da meta, o caso aparece como `Atrasada`, a linha ganha um fio vermelho na fila e entra no indicador do painel. A ordem é pelo **quanto cada caso excedeu a própria meta**, não pelo tempo total: uma entrega parada há 20 h com meta de 24 h não é problema; um caso com o médico há 5 h, com meta de 2 h, é.

As metas vivem em **Configurações** e são da clínica. `js/prazos.js` traz valores propostos para o sistema nascer funcionando — só o de 2 h com o médico veio do plano; o resto é ponto de partida, e a tela diz isso em letras. Campo vazio desliga o alerta daquela etapa: melhor sem meta do que com uma meta inventada. Era por isso que, até aqui, o sistema se recusava a dizer "atrasada" e mostrava apenas "tempo parado" — a recusa estava certa, o que faltava era a meta.

**Avisos dentro do sistema.** Quando o caso entra na etapa de outra equipe, aquela equipe é avisada — sem ninguém precisar lembrar de avisar. O aviso tem destinatário, tem não-lido e some do contador quando é lido, três coisas que uma mensagem solta num grupo nunca teve. Fica no sininho da barra superior.

Não confunda com `comunicacoes`, que continua existindo pelo motivo oposto: ali se **registra o que foi feito fora** do sistema (a ligação ao paciente, o recado no grupo). O sistema não envia nada em `comunicacoes`; ele anota o que já aconteceu. Em `avisos` é o próprio sistema que avisa.

**O próximo passo na própria fila.** É o princípio de tela do plano: *"cada pedido tem um único botão com o próximo passo"*. Um botão, nunca dois — `principal: true` em `js/fluxo.js` marca o caminho normal do processo, e as saídas que são exceção (cancelar, reabrir, pedir esclarecimento, não aprovar) continuam no detalhe, onde há espaço para explicar o que cada uma faz.

Quando o passo precisa de informação — o texto publicado no grupo, o resultado do contato, a decisão clínica, um motivo — o botão **abre o caso já no formulário certo**, por `#acao=`. A fila nunca executa pela metade: ou faz o passo inteiro, ou entrega quem clicou no lugar de fazê-lo.

**A fila se atualiza sozinha.** `js/atualiza.js` confere novidades a cada 12 segundos, dentro da faixa de 10 a 15 s que o plano define. Duas decisões importam mais que o intervalo: a tela **não** é redesenhada por baixo de quem a está usando — aparece uma faixa discreta e quem decide quando atualizar é quem está lendo —, e o relógio **para quando a aba não está à vista**. Em produção é aqui que entra o tempo real do Supabase, sem mexer em nenhuma tela.

### Duas divergências que são decisão da clínica, não do código

**Conclusão × arquivamento.** O plano diz que o pedido só vira concluído quando o paciente foi avisado **e** o prontuário voltou ao arquivo. Este sistema nasceu ao contrário, de propósito: as duas trilhas são independentes, porque na prática a receita fica pronta enquanto a pasta ainda está voltando, e travar a conclusão por causa do arquivo faz a fila mostrar como pendente um atendimento que terminou. As duas leituras se defendem, então virou uma opção em Configurações — desligada por padrão, que é o comportamento atual.

**Conteúdo clínico.** O plano tem uma regra de ouro: *o sistema não guarda informação clínica (diagnóstico, medicamento, queixa)*, e a descrição do pedido deve ser curta, como "nova receita" ou "faltou assinatura". **Este sistema guarda** — `avaliacoes.conteudo_clinico` existe, e há uma permissão inteira construída em volta de quem pode lê-lo (`avaliacao_conteudo`), além da auditoria de leitura.

Isso não é um detalhe de implementação: muda o perfil de risco de LGPD do produto inteiro. Guardar dado de saúde exige base legal, prazo de retenção, encarregado e revisão jurídica; não guardar reduz drasticamente a responsabilidade. **É a primeira pergunta a levar ao gestor do projeto**, antes de qualquer decisão de arquitetura, porque a resposta muda o modelo de dados e o contrato com a nuvem.

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

Tipografia e geometria **não mudam** com o tema: Inter Tight (interface), Instrument Serif (assinatura), IBM Plex Mono (códigos e números). O raio segue a hierarquia da peça — 4 px em etiquetas, 6 px em campos e botões, 10 px em painéis e janelas —, o fio de 1 px separa e uma sombra mínima só sugere o plano do painel sobre o papel; sem brilho, sem desfoque. O monograma é o dossiê e a trilha que a solicitação percorre.

**Rótulo em caixa normal.** Cabeçalho de tabela, campo, indicador e olho de página eram caixa alta de 11 px; agora são frases de 12–13 px em tinta secundária. O que separa rótulo de dado é o tom e o peso, não o grito — e caixa alta se lê pela silhueta do bloco, mais devagar.

**Controle no tamanho do ponteiro.** Com mouse, botão e campo têm 34 px, pela densidade; em tela de toque crescem para 44 px, o alvo mínimo do WCAG. É um token (`--h-ctl`), não uma segunda folha de estilo.

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
7. **O celular é uma tela de verdade, não a de mesa espremida.** A faixa de demonstração cabe numa linha (antes ocupava quase metade da tela, fixa); as filas viram um trilho de chips; toda tabela vira uma lista de cartões "rótulo · valor", sem os campos vazios, com a ordenação numa fileira rolável; filtros recolhem atrás de um botão que conta os que estão em uso; tema e Configurações vão para a gaveta de navegação; e a janela modal sobe da borda de baixo, ao alcance do polegar.
8. **Teclado e leitor de tela.** O primeiro Tab de toda página é "Pular para o conteúdo"; a janela modal prende o foco enquanto está aberta e o devolve a quem a abriu; campo recusado ganha `aria-invalid`; a tabela em cartões mantém os papéis ARIA de tabela, que a troca de `display` apagaria.

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

O que falta para ir ao ar é a parte que não dá para demonstrar: as mesmas regras reescritas no banco, onde não podem ser burladas; login com segundo fator; armazenamento privado dos documentos com endereço assinado e auditoria de leitura; backup testado. E as decisões que só a clínica pode tomar — entre elas as metas de prazo por etapa, que o sistema já sabe cobrar mas se recusa a inventar: campo vazio em **Configurações** desliga o alerta daquela etapa.

---

## Dado pessoal sensível

O sistema trata dado de saúde (LGPD art. 11). A clínica é controladora; quem fornece e opera o sistema é operadora. Consequências que já estão no desenho:

- a matriz de permissões separa **saber que existe um retorno** de **ler o conteúdo clínico**: o Call Center acompanha e comunica sem acessar o texto da avaliação;
- **só a Recepção lê o conteúdo clínico** — e é ela quem o registra. Quem transcreve precisa ler; mais ninguém precisa;
- o Administrador **não** ganha acesso clínico por administrar, mesmo sendo o super usuário;
- a auditoria registra **leitura**, não só alteração, e guarda quem decidiu e quem transcreveu separadamente;
- em produção, nada de cache compartilhado, nada de indexação, nada de `Referer` para fora — já está no `_headers`.

---

## Produto e fornecedor

Prontus é um produto próprio, com marca, repositório, deploy e identidade próprios. A VEMAX é quem o fornece, vende e dá suporte. Trocar essa relação é editar `js/marca.js`.

O acesso do fornecedor **não** é um papel dentro da clínica. Quando o suporte precisar ver um caso, isso será uma concessão temporária, nominal, com prazo e motivo, dada pela clínica — não uma linha permanente na matriz de permissões.

---

### Nota sobre o `serve.json`

Ele existe por um motivo só: o padrão do `serve` é redirecionar `/x.html` para `/x`, e esse
redirecionamento **derruba a query string** — `solicitacoes/detalhe.html?id=…` chegaria sem o `id`
e a tela diria "Solicitação não encontrada". Com `cleanUrls: false`, o endereço local fica igual ao
publicado no Cloudflare. O arquivo não vai para o ar (`.assetsignore`).
