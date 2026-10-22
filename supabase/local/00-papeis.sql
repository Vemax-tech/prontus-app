-- Papéis que o Supabase hospedado já traz; a stack local os cria para a migration rodar igual.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role authenticator login noinherit password 'local-dev-authenticator';
grant anon, authenticated to authenticator;
create role supabase_auth_admin login noinherit createrole password 'local-dev-auth';
create schema auth authorization supabase_auth_admin;
grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
alter role supabase_auth_admin set search_path = auth;
