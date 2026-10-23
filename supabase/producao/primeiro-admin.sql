-- PRONTUS — cria o perfil do PRIMEIRO administrador no Supabase hospedado.
--
-- Antes: crie a conta no painel (Authentication → Users → Add user → Create new user), com
-- "Auto Confirm User" marcado. A senha é definida lá; este script nunca vê nem guarda senha.
-- Depois: cole este script no SQL Editor, troque o e-mail e o nome abaixo e execute UMA vez.
--
-- Só funciona enquanto não existe nenhum administrador. Para os demais usuários, entre como
-- administrador, crie a conta no painel e ajuste o perfil (papel, cargo, ativo) pelo app.
do $$
declare
  v_email text := 'TROQUE@dominio-da-clinica.com.br';  -- e-mail da conta criada no painel
  v_nome  text := 'TROQUE Nome Completo';
  v_id    uuid;
begin
  if exists (select 1 from public.perfis where papel = 'admin') then
    raise exception 'Já existe administrador; este script é só para o primeiro.';
  end if;

  select id into v_id from auth.users where lower(email) = lower(v_email);
  if v_id is null then
    raise exception 'Conta % não encontrada em Authentication → Users. Crie-a primeiro.', v_email;
  end if;

  insert into public.perfis (id, nome, cargo, papel)
  values (v_id, v_nome, 'Administrador', 'admin');
end $$;

-- Conferência: deve listar exatamente uma linha, com ativo = true.
select p.nome, p.papel, p.ativo, u.email
from public.perfis p join auth.users u on u.id = p.id
where p.papel = 'admin';
