-- Pacientes FICTÍCIOS só para a stack local de desenvolvimento (supabase/local/preparar.mjs).
-- Nenhum dado real; nada disto vai para produção. Idempotente: o código do prontuário é único.
with novos (nome, nascimento, telefone, codigo, estante) as (values
  ('Antônio Carlos Ferreira', date '1952-03-14', '(11) 98100-0001', 'PR-2001', 'A-10'),
  ('Maria Aparecida Souza',   date '1961-07-02', '(11) 98100-0002', 'PR-2002', 'B-11'),
  ('José Roberto Lima',       date '1948-11-25', '(11) 98100-0003', 'PR-2003', 'C-12'),
  ('Terezinha Gomes',         date '1955-01-09', '(11) 98100-0004', 'PR-2004', 'D-13'),
  ('Sebastião Alves',         date '1943-06-30', '(11) 98100-0005', 'PR-2005', 'A-14'),
  ('Conceição Batista',       date '1967-09-18', '(11) 98100-0006', 'PR-2006', 'B-15')
), inseridos as (
  insert into public.pacientes (nome, nascimento, telefone)
  select n.nome, n.nascimento, n.telefone from novos n
  where not exists (select 1 from public.prontuarios p where p.codigo = n.codigo)
  returning id, nome
)
insert into public.prontuarios (codigo, paciente_id, local_arquivo)
select n.codigo, i.id, n.estante from inseridos i join novos n on n.nome = i.nome;
