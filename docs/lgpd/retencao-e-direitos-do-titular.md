# LGPD — retenção, eliminação e direitos do titular (rascunho)

> **Rascunho técnico, não parecer jurídico.** Complementa o [inventário e RIPD](inventario-e-ripd.md) e
> descreve o que o sistema guarda hoje (esquema das migrations `0004` a `0006`). Prazos, bases legais e
> o fluxo de atendimento ao titular precisam da validação do encarregado (DPO) e do jurídico da clínica.
> O que depende de decisão da clínica está marcado **[DECIDIR]**; este documento propõe, não decide.

## 1. O que mudou desde o inventário

O inventário foi escrito supondo que o sistema guardaria o texto clínico. A decisão tomada foi **não
guardar**. Na prática:

- A decisão do médico (`avaliacoes`) guarda só o desfecho, quem decidiu (nome e registro) e quem registrou.
  Os itens 4 e 5 do inventário (conteúdo clínico e resumo para o paciente) **deixaram de existir**.
- O documento emitido (`documentos`) guarda metadados e a referência do arquivo, não o conteúdo.
- O relato do paciente (`solicitacao_relatos`) é o dado sensível que sobra, em tabela sem leitura direta.
- O **prontuário em si continua no papel**, fora do sistema. O sistema só sabe onde a pasta está.

Isso muda a retenção: a obrigação legal de guardar o prontuário recai sobre a pasta física e sobre o
sistema de prontuário da clínica (se houver). O Prontus guarda **registros operacionais** do atendimento
(quem pediu, quando, por onde andou, o que foi avisado) e pode ter prazos próprios, mais curtos.

## 2. Regras gerais

1. **Necessidade (art. 6º, III) e fim do tratamento (art. 15 e 16).** Cada dado tem uma finalidade, e
   quando ela acaba o dado é eliminado, ou anonimizado quando só o agregado interessa. A exceção que
   mais pesa aqui é o art. 16, I: guardar para cumprir obrigação legal ou regulatória.
2. **O relógio começa em evento, não em calendário.** O prazo conta do fim da solicitação (conclusão ou
   cancelamento), do último registro do prontuário, ou da desativação da conta, conforme o dado.
3. **Eliminar não apaga a prova de que se eliminou.** Toda eliminação ou anonimização gera uma linha em
   um registro próprio (o quê, quantos, quando, por quem ou por qual rotina), sem repetir o dado.
4. **Dado anonimizado deixa de ser dado pessoal (art. 12)**, desde que não seja reversível por meios
   razoáveis. Anonimizar aqui significa tirar o vínculo com o paciente, não trocar o nome por um apelido.

## 3. Tabela de retenção proposta **[DECIDIR]**

| Dado (tabela) | O que é | Começa a contar | Prazo sugerido | No fim | Fundamento a confirmar |
|---|---|---|---|---|---|
| Identificação do paciente (`pacientes`) | Nome, nascimento, telefone, documento | Último registro do prontuário | Enquanto o prontuário existir | Eliminar junto com o prontuário | Lei 13.787/2018; LGPD, art. 16, I |
| Referência da pasta (`prontuarios`, `movimentos`) | Código, onde está, quem tem | Último movimento | Igual ao do prontuário físico (mínimo de 20 anos) | Eliminar com a pasta | Lei 13.787/2018, art. 6º |
| Registro da decisão do médico (`avaliacoes`, `documentos`) | Desfecho, assinaturas, versões do documento | Data da decisão | 20 anos, como o prontuário | Eliminar com o prontuário | Registra ato clínico; confirmar com o jurídico |
| Histórico operacional (`solicitacoes`, `eventos`, `tarefas`, `comunicacoes`, `entregas`) | Quem pediu, etapas, avisos, entrega | Conclusão ou cancelamento | 5 anos | Anonimizar (cortar o vínculo com o paciente) | Prazo prescricional do CDC, art. 27, como prova em eventual disputa |
| Relato do paciente (`solicitacao_relatos`) | Texto livre, pode citar remédio e dose | Conclusão ou cancelamento | 12 meses | Eliminar o texto, manter o resto | Necessidade: o texto só serve ao atendimento |
| Avisos (`avisos`) | Notificações entre equipes | Leitura | 90 dias | Eliminar | Necessidade |
| Auditoria dos dados (`auditoria_dados`) | Quem fez o quê, inclusive leitura do relato | Data do registro | 5 anos | Eliminar | Art. 37 (registro das operações) e prova de conformidade |
| Auditoria de contas (`auditoria_contas`) | Mudanças de papel e situação | Data do registro | 5 anos | Eliminar | Art. 37 |
| Perfil de funcionário (`perfis`) | Nome, cargo, papel | Desativação da conta | 5 anos | Anonimizar o nome; manter o id nas linhas históricas | Autoria do histórico; necessidade |
| Conta de login (`auth.users`) | E-mail e credencial | Desativação | Até remover o perfil | Excluir a conta no provedor | Necessidade |
| Cópias de segurança | Cópia do banco inteiro | Data da cópia | Conforme o plano contratado (registrar o prazo real) | Expirar sozinhas | Segurança (art. 46) |

Dois pontos para o jurídico decidirem, porque mudam a conta:

- **O histórico operacional precisa mesmo de 5 anos?** O fundamento é guardar prova (por exemplo, quando e
  como o paciente foi avisado). Se a clínica entender que o prazo menor basta, o histórico pode ir a 2 ou
  3 anos.
- **Os registros de decisão do médico seguem os 20 anos do prontuário?** Eles não contêm texto clínico,
  mas comprovam que houve um ato clínico. A proposta é tratá-los como parte da trilha do prontuário.

## 4. Como a eliminação vai acontecer (desenho, não implementado)

Hoje **nada elimina sozinho**, e as tabelas de auditoria são imutáveis até para o administrador, de
propósito. A eliminação precisa de um caminho próprio e controlado:

1. **Rotina de expurgo** (função no banco chamada por agendador, nunca pelo navegador), com `SECURITY
   DEFINER`, que age por regra da tabela da seção 3, em lotes, e roda **primeiro em modo de simulação**
   (só conta o que sairia).
2. **Registro de expurgo** (`expurgos`): data, tabela, regra, quantidade, resultado. Sem dado pessoal.
3. **Anonimização do histórico**: trocar o vínculo com o paciente (`paciente_id`) por nulo ou por um
   identificador sem retorno, e limpar campos de texto livre (`motivo`, `nota`, `texto`).
4. **Auditoria**: o expurgo da própria auditoria é uma exceção escrita na migration, com o gatilho de
   imutabilidade habilitando só para essa função (não para ninguém com login).
5. **Cópias de segurança**: o dado eliminado ainda existe nelas até expirarem. A política deve dizer isso
   ao titular, com o prazo real do plano.

O que precisa existir no esquema para isso: data de conclusão já existe (`concluida_em`); falta a data do
último registro por prontuário (derivável de `movimentos`) e permitir anular `paciente_id` em
`solicitacoes` no momento da anonimização.

## 5. Direitos do titular (LGPD, art. 18)

O titular é o **paciente**, que **não usa o sistema**. Ele pede à clínica, por telefone, e-mail ou na
recepção. O sistema precisa de um caminho para a clínica atender, com prova.

### 5.1 Quem atende **[DECIDIR]**

A matriz atual impede o Administrador de ler a identificação do paciente, e só Call Center e Recepção a
leem. Atender um pedido do titular exige ler tudo sobre ele. Opções:

| Opção | Prós | Contras |
|---|---|---|
| Papel novo `encarregado` (leitura da identificação e do histórico do paciente, sem operar fila) | Separa quem atende o titular de quem opera; cada acesso é auditado | Mais um papel na matriz e no banco |
| A Recepção atende, com aprovação do encarregado fora do sistema | Nenhuma mudança de papel | Acesso amplo a quem opera; a aprovação não fica no sistema |

**Recomendação:** o papel `encarregado`, com acesso só por função auditada (como o relato), nunca por leitura
direta das tabelas.

### 5.2 Como cada direito é atendido

| Direito | O que fazer | O que o sistema oferece hoje | O que falta |
|---|---|---|---|
| Confirmação de que há tratamento e acesso (art. 18, I e II) | Conferir a identidade, localizar o paciente (código do prontuário ou documento), entregar um resumo dos dados | Nada pronto: é leitura manual | Função que devolve, por paciente, o que o sistema guarda (identificação, solicitações, comunicações, entregas), em formato legível |
| Correção (III) | Corrigir nome, telefone ou documento | Edição de paciente não tem tela nem função | Função de correção auditada |
| Anonimização, bloqueio ou eliminação de dado desnecessário (IV) | Avaliar caso a caso: o que não é exigido por lei sai | Nada pronto | Função de anonimização por paciente, usando a mesma lógica do expurgo |
| Portabilidade (V) | Entregar os dados em formato estruturado | Nada pronto | Mesma função do acesso, em JSON ou CSV |
| Eliminação de dado tratado com consentimento (VI) | O Prontus não trata por consentimento (base: tutela da saúde e obrigação legal); explicar isso ao titular | Não se aplica | Texto de resposta |
| Informação sobre compartilhamento (VII) | Informar os suboperadores (seção 1 do inventário) | Lista no inventário | Publicar no aviso de privacidade |
| Revogação do consentimento (IX) | Idem VI | Não se aplica | Idem |

### 5.3 O que **não** se atende, e como dizer

A eliminação **não vale** para o que a clínica é obrigada a guardar (prontuário, art. 16, I). A resposta
precisa explicar o motivo, o prazo e que, passado o prazo, o dado é eliminado. Um pedido de eliminação
que não pode ser atendido continua sendo um pedido: registra-se e responde-se.

### 5.4 Prazo e prova

- **Prazo:** o art. 19 da LGPD fixa **imediato**, em formato simplificado, ou **até 15 dias** para a
  declaração completa. A proposta é adotar 15 dias como prazo interno máximo **[DECIDIR]**.
- **Identidade:** só atender depois de confirmar a identidade do titular (ou do responsável legal). Entregar
  dado de saúde à pessoa errada é um incidente.
- **Registro do pedido:** cada pedido vira uma linha em `pedidos_titular` (data, direito pedido, canal, quem
  atendeu, resultado, data da resposta). Sem copiar o dado pedido para a tabela.

## 6. Plano de implementação em PRs pequenos

1. **Decisões** (este documento): prazos da seção 3, quem atende (5.1) e o prazo interno (5.4).
2. **Tabela de pedidos do titular** e papel do encarregado, com RLS e auditoria.
3. **Função de acesso e portabilidade por paciente**, auditada, só para o encarregado.
4. **Correção de dados do paciente**, auditada.
5. **Rotina de expurgo e anonimização**, com simulação, registro de expurgo e testes (inclusive de que a
   auditoria de leitura não se perde antes do prazo).
6. **Aviso de privacidade** e canal do titular (texto, fora do código), com a lista de suboperadores.

Cada passo é testado contra o Postgres local, como os PRs de banco anteriores.

## 7. Perguntas para a clínica e o jurídico

1. Os prazos da seção 3 estão certos? Em especial: 5 anos para o histórico operacional, 12 meses para o
   relato e 20 anos para o registro da decisão do médico.
2. A clínica tem sistema de prontuário eletrônico, ou o prontuário é só em papel? Isso muda quem guarda os
   20 anos.
3. Quem é o encarregado, e ele terá login no sistema (papel `encarregado`)?
4. Qual o prazo interno para responder ao titular (proposta: 15 dias) e por qual canal o titular pede?
5. Qual é o prazo real das cópias de segurança do plano contratado?
6. O aviso de privacidade já existe? Quem o publica e onde?
