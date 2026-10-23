-- PRONTUS — perfis: quem é cada conta de login e com qual papel entra.
--
-- A SENHA NÃO MORA AQUI. Quem guarda e confere senha é o Supabase Auth (tabela auth.users, hash
-- bcrypt, limite de tentativas, sessão por JWT). Esta tabela só diz, para cada conta, o nome, o
-- cargo e o PAPEL — a mesma lista de js/permissoes.js. O navegador nunca escolhe o próprio papel:
-- não existe política de INSERT nem de UPDATE para ele, só o administrador altera perfis.
--
-- Criar a conta de outra pessoa exige a chave de serviço (convite pelo painel do Supabase ou por
-- função de borda); por isso não há "cadastre-se" aberto: o primeiro administrador é criado com
-- supabase/producao/primeiro-admin.sql (ver LEIAME.md), e os demais pelo administrador.

create table if not exists public.perfis (
  id        uuid primary key references auth.users (id) on delete cascade,
  nome      text not null check (char_length(btrim(nome)) between 2 and 120),
  cargo     text check (cargo is null or char_length(cargo) <= 60),
  papel     text not null check (papel in ('callcenter', 'arquivo', 'recepcao', 'admin')),
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

alter table public.perfis enable row level security;

-- Papel de quem chama, lido SEM passar pela RLS (security definer): uma política de perfis que
-- consultasse perfis recursivamente travaria. Conta desativada não tem papel nenhum.
create or replace function public.meu_papel()
returns text
language sql stable security definer
set search_path = ''
as $$
  select p.papel from public.perfis p where p.id = (select auth.uid()) and p.ativo
$$;
revoke all on function public.meu_papel() from public, anon;
grant execute on function public.meu_papel() to authenticated;

-- Cada pessoa lê o PRÓPRIO perfil (e só enquanto estiver ativa); o administrador lê todos.
drop policy if exists perfis_ler_proprio on public.perfis;
create policy perfis_ler_proprio on public.perfis for select to authenticated
  using (id = (select auth.uid()) and ativo);

drop policy if exists perfis_admin_ler on public.perfis;
create policy perfis_admin_ler on public.perfis for select to authenticated
  using ((select public.meu_papel()) = 'admin');

drop policy if exists perfis_admin_alterar on public.perfis;
create policy perfis_admin_alterar on public.perfis for update to authenticated
  using ((select public.meu_papel()) = 'admin')
  with check ((select public.meu_papel()) = 'admin');

-- Privilégio mínimo: anônimo não toca na tabela; autenticado lê e (via política) o admin atualiza.
revoke all on public.perfis from anon, authenticated;
grant select on public.perfis to authenticated;
grant update (nome, cargo, papel, ativo) on public.perfis to authenticated;

-- Ninguém pode desativar nem rebaixar o último administrador ativo: trancaria a clínica para fora.
create or replace function public.proteger_ultimo_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.papel = 'admin' and old.ativo and (new.papel <> 'admin' or not new.ativo)
     and not exists (select 1 from public.perfis p where p.papel = 'admin' and p.ativo and p.id <> old.id) then
    raise exception 'A clínica precisa de ao menos um administrador ativo.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists perfis_ultimo_admin on public.perfis;
create trigger perfis_ultimo_admin before update on public.perfis
  for each row execute function public.proteger_ultimo_admin();
