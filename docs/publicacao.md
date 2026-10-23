# Checklist de publicação em produção

Roteiro para colocar o Prontus no ar com **dado real de paciente**. Vale para o estado do sistema depois
que os PRs listados na seção 1 forem mergeados. Marque cada item; os que têm **[bloqueia]** impedem a entrada
de dado real. Nada aqui usa a chave `service_role` no navegador ou no repositório.

> Este checklist **não substitui** a validação do jurídico: bases legais, prazos de retenção e o encarregado
> estão em [`lgpd/inventario-e-ripd.md`](lgpd/inventario-e-ripd.md) e
> [`lgpd/retencao-e-direitos-do-titular.md`](lgpd/retencao-e-direitos-do-titular.md).

## 1. Antes de começar

- [ ] **[bloqueia]** PRs mergeados na `main`, nesta ordem sugerida: #7 e #16 (LGPD), #8 (telas por papel),
      #10 (contas), #9 (banco) e #11 (telas no banco); depois #12 a #15 (redesenho e celular). Sem o #9, #10 e #11
      não existem as migrations `0003` a `0006` nem a ligação das telas ao banco.
- [ ] **[bloqueia]** Decisões da clínica respondidas (seção 11 do inventário e seção 7 do documento de
      retenção): encarregado, prazos de retenção, prazo de resposta ao titular, aviso de privacidade.
- [ ] **[bloqueia]** Contrato de operadora com a VEMAX e cláusulas com os suboperadores (Supabase e
      Cloudflare). Conferir se há transferência internacional de dados.
- [ ] Escolher o **plano do Supabase** conferindo o que ele inclui: cópias de segurança diárias, restauração
      pontual e proteção contra senha vazada variam por plano. Para dado de saúde, não use um plano que não
      ofereça cópia de segurança.
- [ ] **Ensaiar tudo num projeto separado** (staging) antes do de produção. Toda a seção 2 a 6 vale para os dois.
      Em staging use só dado fictício.

## 2. Projeto no Supabase

- [ ] **[bloqueia]** Criar o projeto numa **região no Brasil** (São Paulo, `sa-east-1`), para o dado ficar no
      país. Anotar a *Project URL* e a chave **anon** (Settings → API). Não copiar a `service_role` para lugar nenhum.
- [ ] **[bloqueia]** Guardar a senha do banco e a `service_role` num cofre de senhas da clínica, nunca em
      arquivo, e-mail ou conversa.
- [ ] **[bloqueia]** Aplicar as migrations **na ordem**, no SQL Editor (ou `supabase link` + `supabase db push`;
      os nomes `0001_…` não têm carimbo de data, então confira que o comando os aceita, senão use o SQL Editor):
      - [ ] `0001_perfis.sql`
      - [ ] `0002_ultimo_admin_concorrente.sql`
      - [ ] `0003_admin_contas.sql`
      - [ ] `0004_dados_esquema.sql`
      - [ ] `0005_dados_funcoes.sql`
      - [ ] `0006_equipe_e_atrasos.sql`
- [ ] **[bloqueia]** Rodar `supabase/producao/verificar-seguranca.sql` no SQL Editor. **O resultado tem de
      ser vazio** (nenhuma linha). Cada linha é um problema: tabela sem RLS, escrita direta concedida, função
      executável por quem não devia, etc. Só prossiga com a tabela vazia.
- [ ] Conferir em Settings → API que o esquema exposto é só o `public` (o esquema `importacao` do passo 6
      e o `auth` **não** devem estar na lista).

## 3. Autenticação no painel (Authentication)

- [ ] **[bloqueia]** Desligar o cadastro aberto (*Allow new users to sign up*). `supabase/config.toml`
      registra `enable_signup = false`; no projeto hospedado a chave vale só se aplicada
      (`supabase config push`) ou feita à mão no painel. Conferir no painel.
- [ ] **[bloqueia]** Política de senha: mínimo de **12 caracteres**, com minúscula, maiúscula, número e símbolo.
      (O comentário de `config.toml` e o README dizem "10"; **a clínica decide** e o texto deve ser alinhado.)
- [ ] Ligar a proteção contra senha vazada, se o plano permitir.
- [ ] Conferir token de acesso de 15 minutos com rotação do refresh token e os limites de tentativa por IP
      (`supabase/config.toml`).
- [ ] **Segundo fator (MFA): ainda não existe na tela de login.** O Supabase oferece TOTP, mas a tela do
      Prontus não pede o código. **Não ligue a exigência de MFA no painel** enquanto o aplicativo não tiver esse
      passo, ou ninguém consegue entrar. Registrar como pendência (item A8 do inventário).
- [ ] E-mail de convite/recuperação: o fluxo é o administrador criar a conta e definir a senha; a tela de login
      manda "esqueci a senha" falar com o administrador. Não é preciso configurar SMTP próprio agora.

## 4. Primeiro administrador

- [ ] **[bloqueia]** Authentication → Users → *Add user*, com *Auto Confirm User*, e uma **senha forte**
      conforme a política (item 3). A senha é definida ali; nenhum script a vê.
- [ ] **[bloqueia]** Rodar `supabase/producao/primeiro-admin.sql` no SQL Editor, trocando e-mail e nome. O script
      se recusa a rodar se já existir administrador.
- [ ] Criar um **segundo administrador** logo depois. O banco impede desativar o último, mas um só significa que
      perder a conta dele trava a administração.

## 5. Aplicação

- [ ] **[bloqueia]** `js/config.js`: preencher `url` e `anonKey` com os valores do projeto (a chave **anon** é
      pública por desenho; a `service_role` nunca). Isso é um commit: faça por PR.
- [ ] **[bloqueia]** `_headers`: trocar `https://*.supabase.co` em `connect-src` pelo endereço exato do projeto
      (`https://SEU-PROJETO.supabase.co`). Com o curinga, a página poderia falar com qualquer projeto Supabase.
- [ ] Fixar a versão do `wrangler` em `package.json` (`"deploy"` usa `wrangler@latest`): uma versão nova entre
      dois deploys pode mudar o resultado sem aviso.
- [ ] Rodar localmente: `npm test`, `npm run check`, `npm run test:auth`, `npm run test:banco`, `npm run test:app`
      (os três últimos precisam da stack local: `npm run auth:local`). Tudo verde antes de publicar.
- [ ] `npx wrangler login` (conta Cloudflare da clínica ou da VEMAX, conforme o contrato) e `npm run deploy`.
- [ ] Domínio próprio, se houver: Cloudflare → Workers → o projeto `prontus` → Settings → Domains & Routes.
      Atualize o `connect-src` se o Supabase também passar a usar domínio próprio.
- [ ] Conferir os cabeçalhos no site publicado: `curl -sI https://SEU-ENDERECO/` deve mostrar
      `Content-Security-Policy`, `Cache-Control: no-store`, `X-Robots-Tag: noindex` e
      `Strict-Transport-Security`.

## 6. Dados iniciais

- [ ] **[bloqueia]** Importar os pacientes e as pastas: o sistema **ainda não tem tela de cadastro de paciente**.
      Use `supabase/producao/importar-pacientes.sql` (três passos, com a área de passagem em esquema privado,
      que é apagada no fim). Conferir as contagens que o script mostra antes de importar.
- [ ] Apagar o arquivo da planilha da máquina de quem a preparou. Ela tem dado pessoal.
- [ ] **Não** rodar `supabase/local/pacientes-demo.sql`: é só de desenvolvimento.
- [ ] Em Configurações, cadastrar a lista de médicos (nome e registro), as metas de prazo por etapa e o nome
      da clínica. As metas que vêm de fábrica são ponto de partida, não verdade.

## 7. Contas da equipe

- [ ] Para cada pessoa: criar a conta no painel (Authentication → Users, *Auto Confirm User*), depois entrar
      como administrador e **liberar** na tela Usuários (nome, cargo, papel).
- [ ] Um papel por pessoa, o mínimo necessário. O Administrador **não** lê o relato nem a identificação do
      paciente; isso é de propósito.
- [ ] Combinar com cada pessoa a regra de senha e que a senha não se compartilha.

## 8. Teste de fumaça no ar (em staging; depois, o mínimo em produção)

Com uma conta de **cada papel**:

- [ ] Abrir uma página sem estar logado leva ao login e volta para onde estava depois de entrar.
- [ ] Entrar com senha errada dá a mensagem única "E-mail ou senha incorretos".
- [ ] **Call Center:** abre um pedido de receita e vê o relato no detalhe.
- [ ] **Arquivo:** vê o caso na fila, **não** vê o nome do paciente nem o relato, registra localizado e retirado.
- [ ] **Recepção:** confirma o recebimento, leva ao médico, registra o retorno **sem campo de texto clínico**.
- [ ] **Call Center:** registra o contato e a entrega e conclui o caso.
- [ ] **Administrador:** vê o painel e a auditoria, libera uma conta nova, desativa e reativa uma conta, e **não**
      consegue ler o relato (a tentativa é recusada).
- [ ] Desativar uma conta com sessão aberta: na próxima página a pessoa é mandada ao login.
- [ ] Em produção, não crie caso de teste com paciente real. Se precisar testar lá, use um paciente fictício
      cadastrado para isso e avise a equipe; a auditoria é imutável e guardará o teste.

## 9. Operação depois de publicar

- [ ] **Cópias de segurança:** registrar o prazo real do plano e **testar uma restauração** em staging antes de
      confiar nela. Cópia nunca restaurada é só esperança.
- [ ] **Quem desativa** a conta de quem sai da clínica, e em quanto tempo (proposta: no mesmo dia).
- [ ] **Canal do incidente:** quem decide, quem avisa o titular e a ANPD, e como extrair da auditoria quem acessou
      o quê (`auditoria_dados`, `auditoria_contas`). Ver seção 9 do inventário.
- [ ] Rever as dependências a cada mês (`npm audit`) e republicar se houver correção.
- [ ] Rotacionar a senha do banco e as chaves se alguma delas tiver sido exposta, ou ao sair alguém que as conhecia.
- [ ] O aviso de atraso (`escalonar_atrasos`) hoje roda quando alguém abre o sistema. Sem agendador, em fim de
      semana sem ninguém na tela, ninguém é avisado. Avaliar `pg_cron` se a clínica precisar disso.

## 10. Como desfazer

- [ ] **Aplicação:** republicar o commit anterior (`git checkout <commit>` e `npm run deploy`) ou usar
      `npx wrangler rollback`. Não mexe no banco.
- [ ] **Banco:** as migrations só andam para frente. Para voltar, **restaure a cópia de segurança**: por isso o
      teste de restauração da seção 9 não é opcional. Antes de aplicar uma migration nova em produção, tire uma
      cópia manual e ensaie a migration em staging.

## 11. Pendências conhecidas (não bloqueiam, mas a clínica deve saber)

| Pendência | Efeito | Onde está tratada |
|---|---|---|
| MFA não existe na tela de login | Conta protegida só por senha | Item 3; A8 do inventário |
| Máximo de 1000 linhas por consulta | Listas grandes ficam cortadas | README, "Os dados no banco" |
| Sem tela de cadastro de paciente | Pacientes entram por importação | Item 6 |
| Textos livres curtos legíveis por todos os papéis | Pode haver dado pessoal digitado por quem registra | README, PR #9 |
| Retenção, expurgo e direitos do titular sem implementação | Dado não é eliminado sozinho; pedidos do titular são manuais | `lgpd/retencao-e-direitos-do-titular.md` |
| Tokens de sessão em `sessionStorage` | Defesa contra roubo é a CSP fechada | README, "Login" |
| Aviso de atraso sem agendador | Só avisa quando alguém abre o sistema | Item 9 |
