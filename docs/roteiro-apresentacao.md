# Roteiro de apresentação da demonstração

## Como abrir

**No seu computador:** `npm run dev` na raiz do projeto, depois `http://localhost:3000`.

**Publicado (Cloudflare Workers):** o Prontus tem projeto próprio (`prontus` no `wrangler.jsonc`), endereço próprio e cabeçalhos próprios (`_headers`). Não compartilha deploy com nenhum outro sistema.

| Objetivo | Comando | Resultado |
|---|---|---|
| **Endereço só para a apresentação**, sem tocar no que está publicado | `npm run preview` | endereço de versão (preview) próprio, com a demonstração |
| Publicar, depois de aprovar | merge na `main` e `npm run deploy` | o endereço oficial do Prontus |

A primeira vez pede `npx wrangler@latest login` (abre o navegador).

> **Publique no Cloudflare, não no Vercel.** O `_headers` é específico do Cloudflare: em outro provedor a demonstração subiria sem nenhum cabeçalho de segurança, e manter dois arquivos de cabeçalho é garantia de um ficar desatualizado.

---

Não precisa de login, de internet nem de banco. Os dados vivem em memória: o botão **Reiniciar dados** na faixa amarela devolve tudo ao estado inicial, então dá para apresentar quantas vezes quiser sem resíduo.

> **Diga isto na abertura, antes de qualquer tela:** os dados são fictícios e nenhum paciente real existe ali. A faixa amarela no topo diz isso o tempo todo, de propósito.

---

## O que mostrar, em 12 minutos

### 1. A troca de papel (45 s) — o truque que sustenta o resto
Na barra superior, à direita, o seletor de papel. Troque entre **Call Center, Arquivo, Recepção e Administrador** — são quatro papéis, quatro fluxos de trabalho. A cada troca o sistema leva à **tela inicial daquele papel**: o menu muda, a fila muda, os botões mudam.

Fale: *"cada pessoa vê só o que é dela, e não precisa aprender a ignorar menu. Na demonstração eu troco no seletor; em produção vem do login, e o servidor é que decide — não a tela."*

Se perguntarem pelo médico, responda já aqui — é o ponto que mais surpreende:

> *"O médico não entra no sistema. Ele continua no processo exatamente como hoje: a Recepção leva a ficha impressa e o prontuário até a sala e volta com a resposta. O que o sistema faz é marcar que o caso saiu, a quem foi, há quanto tempo está lá, e guardar a resposta assinada com o nome e o CRM de quem decidiu. Uma pessoa a menos para treinar, uma senha a menos para gerenciar, e nenhum passo do processo perdido."*

### 2. Visão geral — duas telas sob o mesmo endereço (1 min 30 s)
Como **Call Center**: a tela inicial é "A sua vez". Os indicadores **são as filas dele**, cada um leva ao trabalho que conta, e o critério embaixo é a própria definição da fila.

Fale: *"quem opera abre o sistema para saber o que fazer agora. Volume, média e pendência de outra equipe são ruído nessa tela."*

Troque para **Administrador**: o mesmo endereço, outra tela. O painel inteiro — todos os indicadores, onde o trabalho empoça, pendência por equipe, volume, tempos, quem tem acesso e as últimas ações registradas.

Fale: *"quem administra abre o sistema para saber como a clínica está. E repare: ele não tem fila. Quem cobra não disputa trabalho com quem é cobrado."*

Mostre que **cada indicador diz o critério de contagem embaixo**. No bloco de pedidos parados, aponte que a meta vem de **Configurações** e é da clínica: *"o sistema não inventa prazo. Ele cobra o que vocês definirem."*

### 3. Fluxo 2 de ponta a ponta (5 min) — o coração da apresentação
Como **Call Center**: Solicitações → *Pedido de receita*. Escolha um paciente, escreva o relato, registre.

- Registre o mesmo paciente e tipo de novo: aparece o **aviso de duplicidade**, que avisa mas **não bloqueia**.
- No detalhe, aponte a **trilha de etapas** no topo (ela diz "etapa 5 de 9") e o bloco **Próxima ação**: diz o que falta, de quem é, e traz ao lado os botões da própria ação.
- *Pedir prontuário ao arquivo*: abre o registro da comunicação. Diga: *"o sistema não manda a mensagem no grupo. Você manda e registra aqui o que foi feito — e o aviso traz o protocolo, para o Call Center saber a qual caso pertence."*

Troque para **Arquivo**: a fila dele já tem o pedido. Localizar → retirar → entregar.

- **Pare aqui.** A solicitação ficou em *Prontuário em trânsito*, não em "entregue". Diga: *"a entrega não está concluída porque o Silvio começou a andar. Só quem recebe confirma."*

Troque para **Recepção**: confirme o recebimento. Tente levar ao médico **antes** de conferir — o sistema recusa. Confira e clique em *Levar ao médico*.

- O formulário pergunta **a quem** o caso foi levado, escolhendo da lista de médicos da clínica. Diga: *"o médico não clica em nada. Mas o sistema precisa saber com quem o caso está, senão a etapa 'Com o médico' não quer dizer nada — e é ela que dispara o alerta de 2 horas."*
- A etapa vira **Com o médico**, e a tela diz, em letras, que o caso está fisicamente fora do sistema.

Ainda como **Recepção**: volte da sala e clique em *Registrar o retorno*. Mostre que o formulário já vem com o nome e o CRM preenchidos, e os dois campos de texto — conteúdo clínico e *resumo para o paciente*.

Fale: *"a decisão é do médico; o registro é de quem foi até a sala. Por isso o registro sai assinado duas vezes: quem decidiu e quem transcreveu. A auditoria responde às duas perguntas separadamente."*

Ainda como **Recepção**: avise no grupo. Troque para **Call Center**: avise o paciente, escolha **entrega digital**.

- Registre só a **tentativa de envio** e tente concluir: o sistema recusa, dizendo que tentativa não é entrega.
- Confirme o recebimento. Agora conclui.

### 4. A trilha paralela do prontuário (1 min)
Com o caso **já concluído**, o prontuário ainda está fora do arquivo. Vá em **Prontuários**: a pendência está lá.

Diga: *"isto é o ponto que mais confunde num sistema mal feito: concluir o atendimento não é arquivar o prontuário. São duas trilhas, controladas separadamente. O atendimento fecha, a pendência administrativa continua visível."*

Depois devolva e arquive como Arquivo, para fechar.

### 5. Usuários e permissões (3 min) — o argumento de segurança
Como **Administrador**, duas telas que só ele tem.

**Usuários.** Crie alguém com um papel; mostre que ele aparece na contagem por papel. Depois tente **excluir a Carla (Recepção)** e leia a mensagem em voz alta:

> *"Ela foi desativada em vez de excluída, porque tem registros no histórico. A linha do tempo de um atendimento não pode passar a dizer '—' no lugar de quem fez. Quem nunca agiu, aí sim, some de verdade."*

Tente ainda rebaixar o próprio Administrador: o sistema recusa, porque a clínica ficaria sem administração.

Fale: *"isto é o que vocês pediram do super usuário: criar e tirar acesso sem abrir chamado comigo. E cada uma dessas ações entra na auditoria."*

**Permissões.** A matriz inteira na tela — quatro papéis, quatro colunas, cabe sem rolar.

Quatro frases que valem a reunião:
- O **Call Center** registra e acompanha, mas **não lê conteúdo clínico** — ele usa o *resumo para o paciente*.
- O **Arquivo** vê o mínimo para localizar um prontuário.
- Só a **Recepção** lê o conteúdo clínico, e é ela quem o registra: quem transcreve precisa ler, mais ninguém precisa.
- O **Administrador não ganha acesso clínico por administrar** — nem sendo o super usuário. Coordenar não é motivo clínico.

Role até **Auditoria de acesso**: dado de saúde exige registrar a **leitura**, não só a alteração.

Para demonstrar ao vivo: como **Recepção**, abra o retorno de um caso; volte em Permissões como Administrador e mostre a linha nova na auditoria.

### 6. Correção de receita com versão (1 min)
Procure a solicitação com receita corrigida (filtro por tipo *Dúvida / correção*). Em **Documentos**, as duas versões coexistem: a v1 marcada como *substituída*, a v2 como *emitida*.

Diga: *"correção nunca sobrescreve. O documento anterior continua existindo."*

### 7. Relatórios (1 min)
Tempo por etapa, pendências por equipe, situação das entregas, movimentações. Exportação em CSV identificando por **protocolo, nunca por nome de paciente**.

---

## O que dizer quando perguntarem "isso já está pronto?"

Resposta honesta, e que joga a favor:

> *"Esta é a vitrine funcional: o fluxo, as regras, as permissões e as telas estão definidos e funcionando. O que falta para ir ao ar é a parte que não dá para demonstrar: as mesmas regras reescritas no banco de dados, onde elas não podem ser burladas, o login com dois fatores, o armazenamento privado dos documentos e o backup testado. Isso está especificado em detalhe e estimado por fases — e depende de sete decisões que só vocês podem tomar."*

Tenha à mão a especificação escrita (perguntas abertas e backlog por fases). **Ela não está neste repositório** — veja o README, seção "Especificação".

## Perguntas que provavelmente virão

| Pergunta | Resposta curta |
|---|---|
| "O WhatsApp manda sozinho?" | Não, e de propósito. Hoje o sistema **registra** o que foi feito. Automação de grupo depende do provedor e é tecnicamente duvidosa — precisa confirmar antes de prometer. |
| "Dá para o paciente acessar?" | Não está no escopo aprovado. O paciente é quem liga; não tem conta. |
| "A IA emite a receita?" | Não. Decisão clínica é exclusiva do profissional, e nenhuma função de IA toca isso. |
| "Por que o médico não entra no sistema?" | Porque ele já não entra hoje, e forçar isso seria o jeito mais rápido de o projeto não sair do papel. O caso vai até ele impresso, com o prontuário. O sistema marca a saída, cobra o prazo e guarda a resposta assinada com nome e CRM. Se um dia vocês quiserem o médico dentro, é um papel a mais na matriz — não uma reescrita. |
| "Quem pode criar usuário?" | Só o Administrador da clínica, na tela **Usuários**. Sem chamado com o fornecedor, e cada mudança entra na auditoria. |
| "E se o prontuário não for encontrado?" | Existe o registro *Não localizado*, que abre pendência e avisa o Call Center. Mas o procedimento real de vocês nesse caso continua sendo uma pergunta aberta. |
| "Onde ficam os dados?" | Na demonstração, em memória, em nada. Em produção, Postgres gerenciado em São Paulo, com acesso por papel verificado no servidor. |
| "Quanto custa?" | A infraestrutura de produção exige plano pago (projeto gratuito pausa sozinho e não tem backup com retenção). Valor conforme a proposta. |

## O que NÃO fazer na apresentação

- Não diga que está "pronto para usar". Está pronto para **ver**.
- Não prometa integração de WhatsApp.
- Não apresente as metas de prazo como recomendação clínica: são um ponto de partida, e a tela de Configurações diz isso em letras. Quem define é a clínica.
- Não diga que "tirou o médico" sem completar a frase. Ele saiu **do sistema**, não do processo — a diferença é a reunião inteira.
- Não use dado real de paciente para "ficar mais convincente". Além de errado, é exatamente o contrário do que você está vendendo.
