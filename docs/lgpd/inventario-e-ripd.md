# LGPD — inventário de dados e relatório de impacto (rascunho)

> **Rascunho técnico, não parecer jurídico.** Foi escrito a partir do que o código faz hoje
> (`js/dados.js`, `js/permissoes.js`, `supabase/migrations/`). Bases legais, prazos e o
> texto final precisam de validação do encarregado (DPO) e do jurídico da clínica. Os itens
> marcados **[DECIDIR]** são decisões da clínica; este documento não as toma.

> **Atualização.** Depois deste inventário ficou decidido **não guardar o texto clínico**: os itens 4 e 5 da
> seção 2 deixaram de existir e a decisão do médico guarda só o desfecho e as assinaturas. Os prazos de
> retenção e o atendimento ao titular estão detalhados em
> [retencao-e-direitos-do-titular.md](retencao-e-direitos-do-titular.md), que prevalece sobre as seções 6 e 7
> deste documento.

## 1. Papéis

| Quem | Papel na LGPD |
|---|---|
| Clínica | **Controladora** (decide finalidades e meios) |
| Fornecedor do sistema (VEMAX) | **Operadora** (trata em nome da clínica; precisa de contrato) |
| Supabase / Cloudflare | **Suboperadores** (infraestrutura; verificar região e cláusulas de transferência internacional) |
| Encarregado (DPO) | **[DECIDIR]** nome e canal de contato; a lei exige a indicação (art. 41) |

## 2. Inventário de dados pessoais

Estado atual: os dados são **fictícios e vivem só na memória do navegador**. As colunas
abaixo descrevem o que existiria com dado real.

| # | Dado | Titular | Tabela / campo | Categoria | Quem lê hoje (matriz) |
|---|---|---|---|---|---|
| 1 | Nome, nascimento, telefone, documento | Paciente | `pacientes` | Pessoal | Call Center (edita), Recepção (vê); Arquivo e Admin só o mínimo |
| 2 | Código do prontuário, localização, custódia | Paciente | `prontuarios`, `movimentos` | Pessoal, ligado a saúde | Todos os papéis |
| 3 | **Relato do pedido (texto livre)** | Paciente | `solicitacoes.relato` | **Pode conter dado de saúde** (ver achado A1) | Call Center, Recepção, Admin; Arquivo o mínimo |
| 4 | **Conteúdo clínico da avaliação** | Paciente | `avaliacoes.conteudo_clinico` | **Sensível (art. 11)** | **Só a Recepção** |
| 5 | **Resumo para o paciente** | Paciente | `avaliacoes.resumo_para_paciente` | **Sensível (art. 11)** | Recepção; verificar se o Call Center o repassa |
| 6 | Nome e CRM do profissional que decidiu | Médico | `avaliacoes` | Pessoal | Recepção, Call Center (existência) |
| 7 | Documentos emitidos (receita etc.) | Paciente | `documentos` | **Sensível (art. 11)** | Conteúdo: Recepção; metadados: Call Center, Admin |
| 8 | Registro de contato (canal, resultado, texto) | Paciente | `comunicacoes` | Pessoal; o texto pode citar nome e prontuário | Todos |
| 9 | Entrega do documento (modo, estado, destinatário autorizado) | Paciente e terceiro autorizado | `entregas` | Pessoal | Call Center, Recepção |
| 10 | Nome, cargo, e-mail, papel | Funcionário | `perfis` (e `usuarios` na demonstração) | Pessoal | Próprio perfil; Admin vê todos |
| 11 | Quem fez o quê e quando; leituras de dado clínico | Funcionário e paciente | `auditoria`, `eventos` | Pessoal (rastreabilidade) | Admin |
| 12 | Credenciais e sessão | Funcionário | `auth.users` (Supabase), `sessionStorage` | Credencial | Ninguém lê a senha (hash); o token fica no navegador |

## 3. Finalidades e bases legais (proposta)

| Finalidade | Dados | Base legal sugerida | Observação |
|---|---|---|---|
| Atender pedido de receita ou dúvida do paciente | 1, 2, 3, 8, 9 | Art. 7º, V (execução de contrato) ou art. 11, II, "f" (tutela da saúde) | **[DECIDIR]** com o jurídico |
| Registrar a decisão clínica e emitir o documento | 4, 5, 6, 7 | Art. 11, II, "f": tutela da saúde, por profissional de saúde | Sensível |
| Guarda do prontuário | 2, 4, 7 | Art. 11, II, "a": obrigação legal (Lei 13.787/2018; Resolução CFM 1.821/2007) | Define a retenção, seção 6 |
| Controle de acesso e trilha de auditoria | 10, 11, 12 | Art. 7º, IX (legítimo interesse) e art. 46 (segurança) | Registrar a avaliação de legítimo interesse |
| Contato com o paciente | 1, 8 | Mesma do atendimento | Canal informado pelo paciente |

## 4. Achados (o que o código faz hoje e precisa mudar)

| ID | Gravidade | Achado | Direção da correção | PR previsto |
|---|---|---|---|---|
| A1 | **Alta** | `relato` é texto livre digitado pelo Call Center e as telas de exemplo trazem medicamento e dose ("posologia", "dose da manhã"). Isso é dado de saúde, mas lido por papéis que a matriz diz que **não** devem ler conteúdo clínico (Admin, Arquivo no mínimo). O README já registra que o plano original pedia descrição curta. | Substituir o texto livre por motivos padronizados e deixar o detalhe clínico só no conteúdo da Recepção. Se o texto livre ficar, tratá-lo como sensível (mesma RLS do conteúdo clínico). **[DECIDIR]** | 4 e 5 |
| A2 | **Alta** | As regras de papel valem só no navegador. Com dado real, um usuário autenticado poderia ler tudo pela API. | Tabelas no Postgres com RLS por papel; a matriz de `js/permissoes.js` vira dado e função no banco. | 4 |
| A3 | Média | A auditoria hoje está em memória, é gravada pelo cliente e pode ser perdida ao recarregar. Não atende ao art. 37 (registro das operações). | Auditoria escrita por gatilho/função no banco, imutável para o app (sem `UPDATE`/`DELETE`). Cobrir também leitura de dado sensível. | 4 |
| A4 | Média | Documento e telefone aparecem completos nas listas. Falta minimização na exibição. | Mascarar por padrão (`***.456-**`, `(11) *****-0001`) e mostrar completo só na ação que exige. | 5 |
| A5 | Média | Não há política de retenção, eliminação nem atendimento a pedidos do titular. | Retenção por tipo de dado, rotina de eliminação/anonimização e fluxo de pedidos do titular (seção 7). | 5 |
| A6 | Média | `comunicacoes.texto` e as mensagens modelo citam nome do paciente e código do prontuário em avisos para equipe. | Usar só o protocolo nos avisos; nome apenas na tela do caso. | 5 |
| A7 | Baixa | Falta aviso de privacidade ao titular e canal do encarregado. | Texto e contato; fora do código. **[DECIDIR]** | — |
| A8 | Baixa | Sem segundo fator para quem lê dado clínico. | Ativar MFA no Supabase para Recepção e Admin. | 3 |

## 5. Minimização e acesso (princípio da necessidade, art. 6º, III)

Já está certo no desenho e deve ser **imposto no banco**, não só na tela:

- Conteúdo clínico: **só a Recepção** lê e registra. O Admin não lê por administrar.
- O Call Center sabe que existe um retorno, sem ver o texto.
- A leitura de conteúdo clínico gera registro de auditoria (hoje `auditarLeitura`).

Falta: tornar essas regras políticas de RLS, mascarar identificadores nas listas (A4) e resolver o A1.

## 6. Retenção (proposta, **[DECIDIR]**)

| Dado | Prazo sugerido | Fundamento |
|---|---|---|
| Prontuário e documentos clínicos (4, 5, 7) | **Mínimo de 20 anos** a partir do último registro | Lei 13.787/2018, art. 6º; confirmar com o jurídico |
| Solicitações, comunicações e entregas (1, 3, 8, 9) | Enquanto o prontuário existir ou prazo menor definido pela clínica | Finalidade de atendimento |
| Auditoria (11) | **[DECIDIR]**, sugestão de 5 anos | Comprovação de conformidade |
| Perfis de funcionários inativos (10) | Desativar na saída; eliminar ou anonimizar após o prazo **[DECIDIR]** | Necessidade |
| Sessões e tokens (12) | Sessão de 30 min sem atividade; token de 15 min | Já implementado |

## 7. Direitos do titular (art. 18) e como atender

| Direito | Como o sistema atende (alvo) |
|---|---|
| Confirmação e acesso | Relatório dos dados do paciente por protocolo, gerado pelo Admin com registro de auditoria |
| Correção | Edição pelo Call Center; correção clínica gera nova versão, a anterior permanece (RN-15) |
| Eliminação | Não se aplica ao que a lei manda guardar (prontuário); o restante é anonimizado ao fim da retenção |
| Portabilidade e informação sobre compartilhamento | Exportação estruturada; lista de suboperadores nesta seção 1 |
| Revogação / oposição | Registrar o pedido e a resposta; **[DECIDIR]** o fluxo com o encarregado |

Prazo de resposta: a ANPD regulamenta; **[DECIDIR]** o prazo interno (sugestão: 15 dias).

## 8. Medidas de segurança já existentes

- Login real (Supabase Auth), perfil e papel no banco com RLS, sessão com expiração e inatividade.
- Cabeçalhos de segurança e CSP fechada em `_headers`; sem `innerHTML` com dado do usuário; CSV neutraliza fórmulas.
- Cadastro aberto desligado; limite de tentativas de login; proteção do último administrador.
- Auditoria de leitura de conteúdo clínico (hoje em memória, ver A3).

## 9. Incidentes (art. 48)

**[DECIDIR]** responsável e canal. A comunicação à ANPD e aos titulares deve ocorrer em prazo
razoável (a regulamentação atual fixa **3 dias úteis**; confirmar a norma vigente). Preparar:
quem decide, modelo de comunicação e como extrair da auditoria quem acessou o quê.

## 10. Pré-requisitos antes de dado real

1. Dados no Postgres com RLS e auditoria no banco (PR 4).
2. A1 resolvido e mascaramento aplicado (PR 5).
3. MFA para papéis com acesso clínico (A8).
4. Contratos com operadora e suboperadores; região do projeto Supabase definida.
5. Encarregado indicado, aviso de privacidade publicado, retenção aprovada.
6. Backup testado, com a mesma proteção do dado original.

## 11. Perguntas para a clínica

1. O sistema deve guardar conteúdo clínico, ou só o fato e o resultado da decisão? (muda A1, o RIPD e o contrato)
2. Quem é o encarregado e qual é o canal do titular?
3. Quais os prazos de retenção aprovados pelo jurídico?
4. O paciente é avisado por qual canal, e há consentimento registrado para contato por mensagem?
5. Onde ficam os dados (região) e há transferência internacional?
