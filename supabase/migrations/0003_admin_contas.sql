-- PRONTUS — o Administrador gerencia as contas de verdade, e cada mudança fica registrada.
--
-- Três peças:
--   1. auditoria_contas — quem mudou o perfil de quem, e o quê. Escrita só por gatilho, nunca pelo
--      aplicativo, e imutável: nem o administrador altera ou apaga uma linha.
--   2. usuarios_da_clinica() — a lista de contas para a tela de Usuários. O e-mail e o último
--      acesso moram em auth.users, que o navegador não lê; a função lê por ele, só para o admin.
--   3. liberar_conta() — dá perfil a uma conta que já existe no Auth. Criar a CONTA (e-mail e
--      senha) exige a chave de serviço e continua sendo feito no painel do Supabase; aqui o
--      administrador só decide nome, cargo e papel.
--
-- Funções security definer sempre com `set search_path = ''` e EXECUTE só para quem precisa.

-- ---------------------------------------------------------------- 1. auditoria
create table if not exists public.auditoria_contas (
  id       bigint generated always as identity primary key,
  quando   timestamptz not null default now(),
  ator_id  uuid,                                   -- sem FK: a linha sobrevive à conta
  acao     text not null check (acao in ('perfil_criado', 'perfil_editado', 'papel_alterado', 'desativado', 'reativado', 'perfil_removido')),
  alvo_id  uuid not null,
  detalhe  jsonb not null default '{}'::jsonb
);
create index if not exists auditoria_contas_alvo on public.auditoria_contas (alvo_id, id desc);

alter table public.auditoria_contas enable row level security;
drop policy if exists auditoria_contas_admin on public.auditoria_contas;
create policy auditoria_contas_admin on public.auditoria_contas for select to authenticated
  using ((select public.meu_papel()) = 'admin');
revoke all on public.auditoria_contas from anon, authenticated;
grant select on public.auditoria_contas to authenticated;

-- Imutável, até para o dono da tabela: corrigir uma trilha de auditoria é falsificá-la.
create or replace function public.auditoria_contas_imutavel()
returns trigger language plpgsql set search_path = ''
as $$ begin raise exception 'A auditoria de contas não pode ser alterada.' using errcode = 'P0001'; end $$;
revoke all on function public.auditoria_contas_imutavel() from public, anon, authenticated;
drop trigger if exists auditoria_contas_sem_alterar on public.auditoria_contas;
create trigger auditoria_contas_sem_alterar before update or delete on public.auditoria_contas
  for each row execute function public.auditoria_contas_imutavel();
drop trigger if exists auditoria_contas_sem_truncar on public.auditoria_contas;
create trigger auditoria_contas_sem_truncar before truncate on public.auditoria_contas
  for each statement execute function public.auditoria_contas_imutavel();

-- O que cada alteração de perfil grava. Quem agiu é o auth.uid() de quem chamou (nulo se foi o
-- banco direto). Nome e cargo não vão no detalhe de edição: só QUAIS campos mudaram.
create or replace function public.auditar_perfil()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  ator uuid := (select auth.uid());
  campos text[];
begin
  if tg_op = 'INSERT' then
    insert into public.auditoria_contas (ator_id, acao, alvo_id, detalhe)
    values (ator, 'perfil_criado', new.id, jsonb_build_object('nome', new.nome, 'papel', new.papel));
  elsif tg_op = 'DELETE' then
    insert into public.auditoria_contas (ator_id, acao, alvo_id, detalhe)
    values (ator, 'perfil_removido', old.id, jsonb_build_object('nome', old.nome, 'papel', old.papel));
  else
    if new.ativo is distinct from old.ativo then
      insert into public.auditoria_contas (ator_id, acao, alvo_id)
      values (ator, case when new.ativo then 'reativado' else 'desativado' end, new.id);
    end if;
    if new.papel is distinct from old.papel then
      insert into public.auditoria_contas (ator_id, acao, alvo_id, detalhe)
      values (ator, 'papel_alterado', new.id, jsonb_build_object('de', old.papel, 'para', new.papel));
    end if;
    campos := array_remove(array[
      case when new.nome is distinct from old.nome then 'nome' end,
      case when new.cargo is distinct from old.cargo then 'cargo' end], null);
    if cardinality(campos) > 0 then
      insert into public.auditoria_contas (ator_id, acao, alvo_id, detalhe)
      values (ator, 'perfil_editado', new.id, jsonb_build_object('campos', to_jsonb(campos)));
    end if;
  end if;
  return null;
end $$;
revoke all on function public.auditar_perfil() from public, anon, authenticated;
drop trigger if exists perfis_auditoria on public.perfis;
create trigger perfis_auditoria after insert or update or delete on public.perfis
  for each row execute function public.auditar_perfil();

-- ---------------------------------------------------------------- 2. lista de contas
create or replace function public.usuarios_da_clinica()
returns table (id uuid, email text, nome text, cargo text, papel text, ativo boolean,
               criado_em timestamptz, ultimo_acesso timestamptz, tem_perfil boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select public.meu_papel()) is distinct from 'admin' then
    raise exception 'Só o Administrador vê as contas.' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text, p.nome, p.cargo, p.papel, coalesce(p.ativo, false),
           coalesce(p.criado_em, u.created_at), u.last_sign_in_at, p.id is not null
    from auth.users u left join public.perfis p on p.id = u.id
    where u.deleted_at is null
    order by (p.id is null) desc, lower(coalesce(p.nome, u.email::text));
end $$;
revoke all on function public.usuarios_da_clinica() from public, anon;
grant execute on function public.usuarios_da_clinica() to authenticated;

-- ---------------------------------------------------------------- 3. liberar uma conta
create or replace function public.liberar_conta(p_id uuid, p_nome text, p_cargo text, p_papel text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if (select public.meu_papel()) is distinct from 'admin' then
    raise exception 'Só o Administrador libera contas.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_id and u.deleted_at is null) then
    raise exception 'Essa conta não existe no login.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.perfis p where p.id = p_id) then
    raise exception 'Essa conta já tem perfil.' using errcode = 'P0001';
  end if;
  insert into public.perfis (id, nome, cargo, papel) values (p_id, btrim(p_nome), nullif(btrim(p_cargo), ''), p_papel);
end $$;
revoke all on function public.liberar_conta(uuid, text, text, text) from public, anon;
grant execute on function public.liberar_conta(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
