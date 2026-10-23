-- PRONTUS — fecha a condição de corrida da proteção do último administrador.
--
-- A função de 0001 conferia "existe outro administrador ativo?" sem trancar nada: com dois
-- administradores, duas transações simultâneas — uma rebaixando cada um — enxergavam, ambas, o
-- OUTRO ainda ativo, ambas passavam, e a clínica terminava sem administrador. O lock abaixo
-- serializa as alterações de administrador: a segunda espera a primeira confirmar e então reconta.

create or replace function public.proteger_ultimo_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.papel = 'admin' and old.ativo and (new.papel <> 'admin' or not new.ativo) then
    perform pg_advisory_xact_lock(hashtext('prontus.ultimo_admin'));
    if not exists (select 1 from public.perfis p where p.papel = 'admin' and p.ativo and p.id <> old.id) then
      raise exception 'A clínica precisa de ao menos um administrador ativo.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

-- Função de gatilho não é para ser chamada por ninguém de fora.
revoke all on function public.proteger_ultimo_admin() from public, anon, authenticated;
