# Publicar o login em produção

Roteiro para ligar o login real (Supabase Auth + Postgres) no ambiente publicado. Nada aqui usa
a chave `service_role`, e nenhuma senha passa por arquivo do repositório.

1. **Projeto no Supabase.** Crie o projeto e anote a *Project URL* e a chave *anon* (Settings → API).
2. **Migrations.** No SQL Editor, execute na ordem `supabase/migrations/0001_perfis.sql`,
   `0002_ultimo_admin_concorrente.sql`, `0003_admin_contas.sql`, `0004_dados_esquema.sql`,
   `0005_dados_funcoes.sql` e `0006_equipe_e_atrasos.sql`. (Ou `supabase link` + `supabase db push`.)
   Os pacientes e prontuários da clínica entram por importação própria: o sistema ainda não tem tela de
   cadastro de paciente, e `supabase/local/pacientes-demo.sql` é só de exemplo, para a stack local.
3. **Auth no painel** (Authentication):
   - Sign In / Providers → desligue *Allow new users to sign up* (só a clínica cria contas).
   - Policies/Password → mínimo de 12 caracteres e, se o plano permitir, *Prevent use of leaked passwords*.
   - Confirme os limites e a rotação de token descritos em `supabase/config.toml`.
4. **Primeiro administrador.** Authentication → Users → *Add user* (com *Auto Confirm User*), depois
   execute `supabase/producao/primeiro-admin.sql` no SQL Editor, trocando e-mail e nome.
5. **`js/config.js`.** Preencha `url` e `anonKey` com os valores do passo 1. Use só a chave **anon**;
   a `service_role` nunca vai para o navegador nem para o repositório.
6. **`_headers`.** Troque `https://*.supabase.co` em `connect-src` pelo endereço exato do projeto
   (`https://SEU-PROJETO.supabase.co`).
7. **Publicar** (`npm run deploy`, conforme o README) e testar: entrar, sair, abrir uma página sem
   sessão (deve ir para o login) e entrar com uma conta de cada papel.

Depois de entrar como administrador, crie cada nova conta no painel (Authentication → Users, com
*Auto Confirm User*). Ela aparece na tela **Usuários** como "aguardando liberação": escolha nome, cargo e
papel. A tela também permite editar, trocar o papel e desativar, e registra cada mudança.
