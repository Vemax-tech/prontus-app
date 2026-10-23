-- PRONTUS — o que as telas precisam além das tabelas de 0004/0005.
--
--   1. equipe()            — nome, cargo e papel de quem trabalha na clínica, para as telas mostrarem
--                            "quem assumiu", "quem registrou". Só o que a linha do tempo já exibe;
--                            e-mail e último acesso continuam só com o Administrador (0003).
--   2. config_clinica.nome — o nome da clínica que aparece nas mensagens.
--   3. escalonar_atrasos() — prazo estourado vira aviso. Na demonstração isto rodava quando a tela
--                            abria; aqui é uma função do banco, idempotente, chamada pela casca e,
--                            quando houver agendador (pg_cron), por ele.

alter table public.config_clinica add column if not exists nome text not null default 'Clínica'
  check (char_length(btrim(nome)) between 1 and 80);

create or replace function public.equipe()
returns table (id uuid, nome text, cargo text, papel text, ativo boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._papel();
  return query select p.id, p.nome, p.cargo, p.papel, p.ativo from public.perfis p order by lower(p.nome);
end $$;
revoke all on function public.equipe() from public, anon;
grant execute on function public.equipe() to authenticated;

-- Avisa UMA VEZ por caso, por etapa e por nível: um alerta que se repete deixa de ser alerta. Passou
-- da meta, avisa a equipe da vez; passou do dobro, avisa também o Administrador.
create or replace function public.escalonar_atrasos()
returns int language plpgsql security definer set search_path = ''
as $$
declare
  v_metas jsonb := (select c.metas from public.config_clinica c where c.id = 1);
  v_novos int := 0;
  s public.solicitacoes;
  v_meta numeric;
  v_horas numeric;
  v_rotulo text;
  v_papel text;
begin
  perform public._papel();
  for s in select * from public.solicitacoes x where x.etapa not in ('concluida', 'cancelada') loop
    v_meta := nullif(v_metas ->> s.etapa, '')::numeric;
    v_horas := extract(epoch from (now() - s.etapa_desde)) / 3600;
    if v_meta is null or v_horas <= v_meta then continue; end if;
    select e.rotulo, e.papeis[1] into v_rotulo, v_papel from public.etapas e where e.etapa = s.etapa;

    if v_papel is not null and not exists (select 1 from public.avisos a where a.solicitacao_id = s.id and a.tipo = 'atraso' and a.etapa = s.etapa) then
      perform public._avisar(s, v_papel, 'atraso', format('Parada em "%s" há %s h. A meta da clínica é %s h.', v_rotulo, round(v_horas), v_meta));
      v_novos := v_novos + 1;
    end if;
    if v_horas >= v_meta * 2 and not exists (select 1 from public.avisos a where a.solicitacao_id = s.id and a.tipo = 'atraso_grave' and a.etapa = s.etapa) then
      perform public._avisar(s, 'admin', 'atraso_grave', format('Parada em "%s" há %s h — mais que o dobro da meta de %s h.', v_rotulo, round(v_horas), v_meta));
      v_novos := v_novos + 1;
    end if;
  end loop;
  return v_novos;
end $$;
revoke all on function public.escalonar_atrasos() from public, anon;
grant execute on function public.escalonar_atrasos() to authenticated;

notify pgrst, 'reload schema';
