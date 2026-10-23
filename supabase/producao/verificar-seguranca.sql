-- PRONTUS — confere, no banco publicado, as garantias de segurança que o código assume.
--
-- Rode no SQL Editor DEPOIS de aplicar as migrations e ANTES de cadastrar paciente real.
-- Cada linha devolvida é um PROBLEMA; resultado vazio = tudo certo. Só lê o catálogo: não altera nada.
--
-- O que confere:
--   1. toda tabela do esquema public tem RLS ligada;
--   2. quem tem login (authenticated) e quem não tem (anon) não escrevem direto em tabela nenhuma
--      (a única exceção é a atualização por coluna de `perfis`, que a RLS limita ao administrador);
--   3. quem não fez login não lê tabela nenhuma de dados;
--   4. toda função `security definer` fixa o search_path;
--   5. nenhuma função pública é executável por anon ou pelo grupo PUBLIC;
--   6. as funções internas (prefixo _) não são executáveis por quem tem login;
--   7. existe ao menos um administrador ativo.

with
tabelas as (
  select c.relname as tabela, c.relrowsecurity as rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
privilegios as (
  select table_name as tabela, grantee, privilege_type as privilegio
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
),
funcoes as (
  select p.oid, p.proname, p.prosecdef, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
)
select 'tabela sem RLS' as problema, tabela as onde, null::text as detalhe from tabelas where not rls
union all
select 'escrita direta concedida', tabela, grantee || ' ' || privilegio
  from privilegios where privilegio <> 'SELECT'
union all
select 'anon lê tabela', tabela, privilegio from privilegios where grantee = 'anon'
union all
select 'security definer sem search_path fixo', proname, null
  from funcoes where prosecdef and not coalesce(proconfig @> array['search_path=""'], false)
union all
select 'função executável por anon ou PUBLIC', f.proname, a.grantee_nome
  from funcoes f
  cross join lateral (
    select case when acl.grantee = 0 then 'PUBLIC' else r.rolname end as grantee_nome
    from aclexplode(coalesce((select proacl from pg_proc where oid = f.oid), acldefault('f', (select proowner from pg_proc where oid = f.oid)))) acl
    left join pg_roles r on r.oid = acl.grantee
    where acl.privilege_type = 'EXECUTE'
  ) a
  where a.grantee_nome in ('PUBLIC', 'anon')
union all
select 'função interna executável por quem tem login', proname, null
  from funcoes where proname like '\_%' and has_function_privilege('authenticated', oid, 'EXECUTE')
union all
select 'nenhum administrador ativo', 'perfis', null
  where to_regclass('public.perfis') is not null
    and not exists (select 1 from public.perfis where papel = 'admin' and ativo);
