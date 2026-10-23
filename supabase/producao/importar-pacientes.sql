-- PRONTUS — importa pacientes e prontuários de uma planilha (o sistema ainda não tem tela de cadastro).
--
-- Rode no SQL Editor, em três passos, com a conta DONA do projeto (não pelo aplicativo):
--
--   PASSO 1  — execute só o bloco "preparar". Ele cria uma área de passagem num esquema PRIVADO
--              (`importacao`), que a API do Supabase não expõe. Não crie a área de passagem em
--              `public`: lá ela ficaria acessível pela API.
--   PASSO 2  — Table Editor → esquema `importacao` → tabela `pacientes` → Insert → Import data from
--              CSV. Colunas do CSV: nome, nascimento (AAAA-MM-DD), telefone, documento, codigo, estante.
--              Cada linha é um paciente com a sua pasta. Confira o resultado com um select.
--   PASSO 3  — execute o bloco "importar", depois o bloco "limpar". A área de passagem guarda dado
--              pessoal: não deixe ela existindo.
--
-- Regras: o código do prontuário é único (linha repetida é ignorada, o que torna o bloco repetível), e
-- cada paciente tem uma pasta só. Nada aqui lê conteúdo clínico: só identificação e onde a pasta fica.

-- ============================================================ preparar
create schema if not exists importacao;
revoke all on schema importacao from public, anon, authenticated;
create table if not exists importacao.pacientes (
  nome        text,
  nascimento  date,
  telefone    text,
  documento   text,
  codigo      text,
  estante     text
);
revoke all on importacao.pacientes from public, anon, authenticated;

-- ============================================================ importar
-- Conta antes, para você conferir o que vai entrar.
select count(*) as linhas_na_planilha,
       count(*) filter (where nome is null or codigo is null) as sem_nome_ou_codigo,
       count(*) filter (where codigo in (select codigo from public.prontuarios)) as codigo_ja_existe
from importacao.pacientes;

-- O id do paciente nasce AQUI, antes dos dois inserts: ligar a pasta ao paciente por nome e data
-- erraria com homônimos (mesmo nome, mesma data, sem documento).
with novos as (
  select distinct on (btrim(codigo)) gen_random_uuid() as id, btrim(nome) as nome, nascimento,
         nullif(btrim(telefone), '') as telefone, nullif(btrim(documento), '') as documento,
         btrim(codigo) as codigo, nullif(btrim(estante), '') as estante
  from importacao.pacientes
  where nome is not null and btrim(nome) <> '' and codigo is not null and btrim(codigo) <> ''
    and btrim(codigo) not in (select codigo from public.prontuarios)
  order by btrim(codigo)
), pacientes_novos as (
  insert into public.pacientes (id, nome, nascimento, telefone, documento)
  select id, nome, nascimento, telefone, documento from novos
  returning id
)
insert into public.prontuarios (codigo, paciente_id, local_arquivo)
select n.codigo, n.id, n.estante from novos n join pacientes_novos using (id);

select count(*) as pacientes_cadastrados from public.pacientes;

-- ============================================================ limpar
drop table if exists importacao.pacientes;
drop schema if exists importacao;
