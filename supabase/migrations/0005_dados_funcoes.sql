-- PRONTUS — as regras que mudam os dados, dentro do banco.
--
-- É o espelho em SQL das funções de js/dados.js (moverSolicitacao, moverProntuario, …). O
-- navegador só chama; quem confere papel, etapa e condições é a função, e uma recusa desfaz tudo
-- (cada função roda numa transação só). As tabelas não aceitam escrita direta (0004).
--
-- CONVENÇÕES
--   · Toda função pública começa por public._papel(): sem perfil ativo, 42501.
--   · Recusa por papel = 42501 ("Sem permissão"); recusa por regra do fluxo = P0001, com a
--     mensagem escrita aqui, em português, para a tela mostrar como está (mensagemErro()).
--   · Quem agiu é sempre auth.uid() do token, nunca um argumento: o navegador não se identifica.
--   · Cada mudança grava uma linha em auditoria_dados.
--   · Funções internas (prefixo _) não têm EXECUTE para ninguém de fora.

-- ---------------------------------------------------------------- internas
create or replace function public._papel()
returns text language plpgsql stable security definer set search_path = ''
as $$
declare p text := public.meu_papel();
begin
  if p is null then raise exception 'Sem permissão para esta ação.' using errcode = '42501'; end if;
  return p;
end $$;

create or replace function public._rotulo_papel(p text)
returns text language sql immutable set search_path = ''
as $$ select case p when 'callcenter' then 'Call Center' when 'arquivo' then 'Arquivo'
  when 'recepcao' then 'Recepção' when 'admin' then 'Administrador' else p end $$;

create or replace function public._auditar(p_acao text, p_recurso text, p_sol uuid, p_detalhe text default null)
returns void language sql security definer set search_path = ''
as $$
  insert into public.auditoria_dados (ator_id, papel, acao, recurso, solicitacao_id, detalhe)
  values ((select auth.uid()), public.meu_papel(), p_acao, p_recurso, p_sol, left(p_detalhe, 300));
$$;

create or replace function public._evento(p_sol uuid, p_de text, p_para text, p_titulo text, p_nota text)
returns void language sql security definer set search_path = ''
as $$
  insert into public.eventos (solicitacao_id, de_etapa, para_etapa, titulo, ator_id, nota)
  values (p_sol, p_de, p_para, p_titulo, (select auth.uid()), left(p_nota, 400));
$$;

create or replace function public._papeis_da_etapa(p_etapa text)
returns text[] language sql stable security definer set search_path = ''
as $$ select coalesce((select e.papeis from public.etapas e where e.etapa = p_etapa), '{}') $$;

create or replace function public._nome_de(p_id uuid)
returns text language sql stable security definer set search_path = ''
as $$ select coalesce((select p.nome from public.perfis p where p.id = p_id), 'outra pessoa') $$;

create or replace function public._sincronizar_tarefas(p_sol uuid, p_etapa text, p_dono uuid)
returns void language sql security definer set search_path = ''
as $$
  update public.tarefas t set responsavel_id = p_dono
  where t.solicitacao_id = p_sol and t.estado = 'pendente'
    and t.papel_responsavel = any(public._papeis_da_etapa(p_etapa));
$$;

create or replace function public._proxima_tarefa(p_sol public.solicitacoes)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_papel text := (public._papeis_da_etapa(p_sol.etapa))[1];
  v_texto text;
begin
  if v_papel is null then return; end if;
  if exists (select 1 from public.tarefas t where t.solicitacao_id = p_sol.id and t.estado = 'pendente' and t.papel_responsavel = v_papel) then
    return;
  end if;
  select case when p_sol.tipo = 'pedido_receita' and e.proxima_acao_receita is not null then e.proxima_acao_receita else e.proxima_acao end
    into v_texto from public.etapas e where e.etapa = p_sol.etapa;
  insert into public.tarefas (solicitacao_id, papel_responsavel, titulo, responsavel_id)
  values (p_sol.id, v_papel, v_texto, p_sol.assumido_por);
end $$;

create or replace function public._avisar(p_sol public.solicitacoes, p_para text, p_tipo text, p_texto text)
returns void language sql security definer set search_path = ''
as $$
  insert into public.avisos (solicitacao_id, protocolo, etapa, para_papel, tipo, texto)
  values (p_sol.id, p_sol.protocolo, p_sol.etapa, p_para, p_tipo, left(p_texto, 300));
$$;

-- Agir é assumir: quem age num caso sem dono, estando na vez da sua equipe, passa a ser o dono.
create or replace function public._assumir_se_livre(p_sol uuid, p_papel text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_ator uuid := (select auth.uid()); v_etapa text;
begin
  update public.solicitacoes s set assumido_por = v_ator, assumido_em = now()
  where s.id = p_sol and s.assumido_por is null
    and s.etapa not in ('concluida', 'cancelada') and p_papel = any(public._papeis_da_etapa(s.etapa))
  returning s.etapa into v_etapa;
  if found then perform public._sincronizar_tarefas(p_sol, v_etapa, v_ator); end if;
end $$;

-- RN-06: o que ainda falta para poder concluir. Lista vazia = pode concluir.
create or replace function public._pendencias_para_concluir(p_sol public.solicitacoes)
returns text[] language plpgsql stable security definer set search_path = ''
as $$
declare
  faltas text[] := '{}';
  v_entrega public.entregas;
begin
  if not exists (select 1 from public.comunicacoes c where c.solicitacao_id = p_sol.id
                 and c.tipo = 'contato_paciente' and c.resultado in ('falou', 'recado')) then
    faltas := array_append(faltas, 'Nenhum contato efetivo com o paciente (tentativa sem sucesso não conta).'::text);
  end if;
  if p_sol.tipo = 'pedido_receita' then
    if not exists (select 1 from public.avaliacoes a where a.solicitacao_id = p_sol.id) then
      faltas := array_append(faltas, 'O retorno do médico ainda não foi registrado.'::text);
    end if;
    if not exists (select 1 from public.avaliacoes a where a.solicitacao_id = p_sol.id and a.desfecho = 'nao_aprovado') then
      select * into v_entrega from public.entregas e where e.solicitacao_id = p_sol.id;
      if not found then
        faltas := array_append(faltas, 'A entrega da receita ainda não foi registrada.'::text);
      elsif v_entrega.estado not in ('enviado', 'retirada_confirmada') then
        faltas := array_append(faltas, case when v_entrega.estado = 'envio_tentado'
          then 'O envio foi tentado, mas não há confirmação. Tentativa não é entrega (RN-13).'::text
          else format('A entrega está em "%s" e ainda não foi confirmada.', v_entrega.estado) end);
      end if;
    end if;
  end if;
  return faltas;
end $$;

revoke all on function public._papel(), public._rotulo_papel(text), public._auditar(text, text, uuid, text),
  public._evento(uuid, text, text, text, text), public._papeis_da_etapa(text), public._nome_de(uuid),
  public._sincronizar_tarefas(uuid, text, uuid), public._proxima_tarefa(public.solicitacoes),
  public._avisar(public.solicitacoes, text, text, text), public._assumir_se_livre(uuid, text),
  public._pendencias_para_concluir(public.solicitacoes)
  from public, anon, authenticated;

-- ---------------------------------------------------------------- abrir, assumir, liberar
create or replace function public.abrir_solicitacao(p_tipo text, p_paciente uuid, p_relato text, p_prioridade text default 'normal')
returns public.solicitacoes language plpgsql security definer set search_path = ''
as $$
declare
  v_papel text := public._papel();
  v_ator uuid := (select auth.uid());
  v_pront uuid;
  v_sol public.solicitacoes;
begin
  if v_papel <> 'callcenter' then raise exception 'Só o Call Center abre solicitação.' using errcode = '42501'; end if;
  if not exists (select 1 from public.pacientes p where p.id = p_paciente) then
    raise exception 'Selecione um paciente.' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_relato, '')) = '' then raise exception 'Descreva o pedido.' using errcode = 'P0001'; end if;
  select pr.id into v_pront from public.prontuarios pr where pr.paciente_id = p_paciente;

  -- Quem registra a ligação já está com o caso: abrir é a primeira etapa, e ela é de quem abriu.
  insert into public.solicitacoes (tipo, paciente_id, prontuario_id, prioridade, aberta_por, assumido_por, assumido_em)
  values (p_tipo, p_paciente, v_pront, p_prioridade, v_ator, v_ator, now())
  returning * into v_sol;
  insert into public.solicitacao_relatos (solicitacao_id, relato) values (v_sol.id, btrim(p_relato));
  perform public._evento(v_sol.id, null, 'aberta', null, 'Solicitação registrada pelo Call Center.');
  insert into public.tarefas (solicitacao_id, papel_responsavel, titulo, responsavel_id)
  values (v_sol.id, 'callcenter', 'Pedir o prontuário ao arquivo', v_ator);
  perform public._auditar('criacao', 'solicitacao', v_sol.id, 'protocolo ' || v_sol.protocolo);
  return v_sol;
end $$;

create or replace function public.assumir_solicitacao(p_id uuid)
returns public.solicitacoes language plpgsql security definer set search_path = ''
as $$
declare
  v_papel text := public._papel();
  v_ator uuid := (select auth.uid());
  v_sol public.solicitacoes;
  v_vez text[];
begin
  select * into v_sol from public.solicitacoes s where s.id = p_id for update;
  if not found then raise exception 'Solicitação não encontrada.' using errcode = 'P0001'; end if;
  if v_sol.etapa in ('concluida', 'cancelada') then
    raise exception 'O caso já foi encerrado: não há etapa para assumir.' using errcode = 'P0001';
  end if;
  v_vez := public._papeis_da_etapa(v_sol.etapa);
  if not v_papel = any(v_vez) then
    raise exception 'Nesta etapa a vez é do papel %.', (select string_agg(public._rotulo_papel(x), ' / ') from unnest(v_vez) x)
      using errcode = '42501';
  end if;
  if v_sol.assumido_por = v_ator then return v_sol; end if;
  if v_sol.assumido_por is not null then
    raise exception '% já assumiu este caso. Peça para liberar antes.', public._nome_de(v_sol.assumido_por) using errcode = 'P0001';
  end if;
  update public.solicitacoes s set assumido_por = v_ator, assumido_em = now() where s.id = p_id returning * into v_sol;
  perform public._sincronizar_tarefas(p_id, v_sol.etapa, v_ator);
  perform public._evento(p_id, null, v_sol.etapa, 'Caso assumido',
    format('%s assumiu a etapa "%s".', public._nome_de(v_ator), (select e.rotulo from public.etapas e where e.etapa = v_sol.etapa)));
  perform public._auditar('assumir', 'solicitacao', p_id, v_sol.etapa);
  return v_sol;
end $$;

create or replace function public.liberar_solicitacao(p_id uuid, p_motivo text default null)
returns public.solicitacoes language plpgsql security definer set search_path = ''
as $$
declare
  v_papel text := public._papel();
  v_ator uuid := (select auth.uid());
  v_sol public.solicitacoes;
  v_quem uuid;
  v_nota text;
begin
  select * into v_sol from public.solicitacoes s where s.id = p_id for update;
  if not found then raise exception 'Solicitação não encontrada.' using errcode = 'P0001'; end if;
  if v_sol.assumido_por is null then raise exception 'Este caso não está assumido por ninguém.' using errcode = 'P0001'; end if;
  -- Quem assumiu libera; a coordenação (quem edita solicitação) também, para destravar.
  if v_sol.assumido_por <> v_ator and v_papel not in ('callcenter', 'admin') then
    raise exception 'Só quem assumiu o caso pode liberá-lo.' using errcode = '42501';
  end if;
  v_quem := v_sol.assumido_por;
  update public.solicitacoes s set assumido_por = null, assumido_em = null where s.id = p_id returning * into v_sol;
  perform public._sincronizar_tarefas(p_id, v_sol.etapa, null);
  v_nota := case when v_quem = v_ator
    then format('%s devolveu o caso à fila da equipe.', public._nome_de(v_ator))
    else format('%s liberou o caso que estava com %s.', public._nome_de(v_ator), public._nome_de(v_quem)) end
    || case when btrim(coalesce(p_motivo, '')) <> '' then ' — ' || btrim(p_motivo) else '' end;
  perform public._evento(p_id, null, v_sol.etapa, 'Caso liberado', v_nota);
  perform public._auditar('liberar', 'solicitacao', p_id, v_sol.etapa);
  return v_sol;
end $$;

-- ---------------------------------------------------------------- prontuário (custódia)
create or replace function public.mover_prontuario(p_prontuario uuid, p_mov text, p_solicitacao uuid default null, p_nota text default null)
returns public.prontuarios language plpgsql security definer set search_path = ''
as $$
declare
  v_papel text := public._papel();
  v_ator uuid := (select auth.uid());
  v_pront public.prontuarios;
  v_regra public.mov_validos;
  v_feitos text[] := '{}';
  v_antes text;
begin
  -- Sempre a solicitação ANTES do prontuário, a mesma ordem de mover_solicitacao: ordens
  -- diferentes entre duas funções simultâneas travariam uma na outra (deadlock).
  if p_solicitacao is not null then
    perform 1 from public.solicitacoes s where s.id = p_solicitacao for update;
    if not found then raise exception 'Solicitação não encontrada.' using errcode = 'P0001'; end if;
    select coalesce(array_agg(m.tipo), '{}') into v_feitos from public.movimentos m where m.solicitacao_id = p_solicitacao;
  end if;
  select * into v_pront from public.prontuarios p where p.id = p_prontuario for update;
  if not found then raise exception 'Prontuário não encontrado.' using errcode = 'P0001'; end if;

  select * into v_regra from public.mov_validos m
  where m.mov = p_mov and v_pront.local = any(m.de) and v_papel = any(m.papeis)
    and (m.exige_antes is null or m.exige_antes = any(v_feitos))
    and not (m.mov = 'localizado' and 'localizado' = any(v_feitos) and v_pront.local = 'arquivo' and 'retirado' = any(v_feitos));
  if not found then
    if exists (select 1 from public.mov_validos m where m.mov = p_mov and not v_papel = any(m.papeis)) then
      raise exception 'Este registro é do papel %.',
        (select string_agg(public._rotulo_papel(x), ' ou ') from public.mov_validos m, unnest(m.papeis) x where m.mov = p_mov)
        using errcode = '42501';
    end if;
    select m.exige_antes into v_antes from public.mov_validos m
    where m.mov = p_mov and v_pront.local = any(m.de) and v_papel = any(m.papeis)
      and m.exige_antes is not null and not m.exige_antes = any(v_feitos) limit 1;
    if v_antes is not null then
      raise exception 'Falta registrar o passo anterior (%).',
        (select m.rotulo from public.mov_validos m where m.mov = v_antes limit 1) using errcode = 'P0001';
    end if;
    raise exception 'Esse movimento não é possível com o prontuário onde ele está agora.' using errcode = 'P0001';
  end if;

  -- RN-17: repetir a mesma requisição não cria movimentação duplicada.
  if p_mov = any(v_feitos) and p_mov <> 'localizado' then return v_pront; end if;

  if p_solicitacao is not null then perform public._assumir_se_livre(p_solicitacao, v_papel); end if;
  insert into public.movimentos (prontuario_id, solicitacao_id, tipo, ator_id, nota)
  values (p_prontuario, p_solicitacao, p_mov, v_ator, left(coalesce(p_nota, ''), 300));
  update public.prontuarios p set local = v_regra.para, custodia_usuario_id = v_ator,
    solicitacao_id = case when p_mov = 'arquivado' then null else p.solicitacao_id end
  where p.id = p_prontuario returning * into v_pront;
  perform public._auditar('movimento', 'prontuario', p_solicitacao, v_regra.rotulo || ' → ' || v_regra.para);
  return v_pront;
end $$;

-- ---------------------------------------------------------------- mover a solicitação
create or replace function public.mover_solicitacao(p_id uuid, p_transicao text, p_motivo text default null,
  p_nota text default null, p_medico_nome text default null, p_medico_registro text default null)
returns public.solicitacoes language plpgsql security definer set search_path = ''
as $$
declare
  v_papel text := public._papel();
  v_ator uuid := (select auth.uid());
  v_sol public.solicitacoes;
  v_t public.transicoes;
  v_de text;
  v_cfg public.config_clinica;
  v_faltas text[];
  v_pront public.prontuarios;
  v_dono_papel text;
  v_medico text;
  v_registro text;
begin
  select * into v_sol from public.solicitacoes s where s.id = p_id for update;
  if not found then raise exception 'Solicitação não encontrada.' using errcode = 'P0001'; end if;

  select * into v_t from public.transicoes t
  where t.id = p_transicao and v_papel = any(t.papeis)
    and (t.de = v_sol.etapa or (t.de = '*' and v_sol.etapa not in ('concluida', 'cancelada')))
    and (t.tipos is null or v_sol.tipo = any(t.tipos));
  if not found then raise exception 'Essa ação não é permitida para o seu papel nesta etapa.' using errcode = '42501'; end if;

  if v_t.exige_motivo and btrim(coalesce(p_motivo, '')) = '' then raise exception 'Informe o motivo.' using errcode = 'P0001'; end if;
  if v_t.exige_conferencia and not exists (select 1 from public.movimentos m where m.solicitacao_id = p_id and m.tipo = 'conferido') then
    raise exception 'Registre a conferência do prontuário antes de levar o caso ao médico.' using errcode = 'P0001';
  end if;
  if v_t.exige_comunicacao is not null and not exists (select 1 from public.comunicacoes c
      where c.solicitacao_id = p_id and c.tipo = any(v_t.exige_comunicacao) and c.criado_em >= v_sol.etapa_desde) then
    raise exception 'Registre o aviso antes de avançar a etapa.' using errcode = 'P0001';
  end if;

  select * into v_cfg from public.config_clinica where id = 1;
  -- T06: o caso sai do sistema e vai para a mão de alguém; sem saber de quem, não dá para dizer
  -- com quem ele está nem assinar o retorno quando voltar.
  if v_t.exige_medico then
    v_medico := btrim(coalesce(p_medico_nome, ''));
    if v_medico = '' then raise exception 'Informe a qual médico o caso foi levado.' using errcode = 'P0001'; end if;
    v_registro := btrim(coalesce(nullif(btrim(p_medico_registro), ''),
      (select m ->> 'registro' from jsonb_array_elements(v_cfg.medicos) m where m ->> 'nome' = v_medico limit 1), ''));
    update public.solicitacoes s set medico_nome = v_medico, medico_registro = v_registro where s.id = p_id returning * into v_sol;
  end if;

  -- RN-06: conclusão só com os requisitos do tipo cumpridos.
  if v_t.para = 'concluida' and v_t.desfecho = 'resolvida' then
    v_faltas := public._pendencias_para_concluir(v_sol);
    select * into v_pront from public.prontuarios p where p.id = v_sol.prontuario_id;
    if v_cfg.exigir_arquivamento_para_concluir and found and v_pront.local <> 'arquivo' then
      v_faltas := array_append(v_faltas, format('O prontuário ainda está em "%s" e a clínica exige o arquivamento antes de concluir.', v_pront.local));
    end if;
    if cardinality(v_faltas) > 0 then raise exception 'Não é possível concluir: %', v_faltas[1] using errcode = 'P0001'; end if;
  end if;

  -- T04 e T05: a etapa e a pasta andam juntas, num clique só. Se a custódia não permitir, a
  -- função inteira falha e nada muda em nenhum dos dois eixos.
  if v_t.via_prontuario is not null and v_sol.prontuario_id is not null
     and not exists (select 1 from public.movimentos m where m.solicitacao_id = p_id and m.tipo = v_t.via_prontuario) then
    perform public.mover_prontuario(v_sol.prontuario_id, v_t.via_prontuario, p_id,
      format('Registrado junto com o passo "%s".', v_t.rotulo));
    select * into v_sol from public.solicitacoes s where s.id = p_id;
  end if;

  perform public._assumir_se_livre(p_id, v_papel);
  select * into v_sol from public.solicitacoes s where s.id = p_id;

  v_de := v_sol.etapa;
  update public.solicitacoes s set
    etapa = v_t.para, etapa_desde = now(),
    desfecho = case when v_t.id = 'T16' then null when v_t.desfecho is not null then v_t.desfecho else s.desfecho end,
    concluida_em = case when v_t.id = 'T16' then null when v_t.desfecho is not null then now() else s.concluida_em end,
    reaberturas = s.reaberturas + case when v_t.id = 'T16' then 1 else 0 end,
    motivo = case when btrim(coalesce(p_motivo, '')) <> '' then left(btrim(p_motivo), 200) else s.motivo end
  where s.id = p_id returning * into v_sol;

  -- A posse vale por etapa: se a nova etapa já não é da equipe de quem assumiu, o caso volta à
  -- fila dela sem dono (o nome de quem respondeu pelo trecho anterior fica no histórico).
  if v_sol.assumido_por is not null then
    select p.papel into v_dono_papel from public.perfis p where p.id = v_sol.assumido_por;
    if v_dono_papel is null or not v_dono_papel = any(public._papeis_da_etapa(v_sol.etapa)) then
      update public.solicitacoes s set assumido_por = null, assumido_em = null where s.id = p_id returning * into v_sol;
    end if;
  end if;

  perform public._evento(p_id, v_de, v_t.para, null,
    coalesce(nullif(btrim(p_nota), ''), v_t.rotulo || case when btrim(coalesce(p_motivo, '')) <> '' then ' — ' || btrim(p_motivo) else '' end));

  if v_t.para in ('concluida', 'cancelada') and v_t.desfecho is distinct from 'nao_aprovada' then
    update public.tarefas t set estado = 'concluida', concluida_em = now() where t.solicitacao_id = p_id and t.estado = 'pendente';
  end if;
  perform public._proxima_tarefa(v_sol);

  -- A equipe da vez é avisada; quem acabou de agir, não.
  if v_sol.etapa in ('concluida', 'cancelada') then
    select * into v_pront from public.prontuarios p where p.id = v_sol.prontuario_id;
    if found and v_pront.local <> 'arquivo' then
      perform public._avisar(v_sol, case when v_pront.local in ('arquivo', 'em_transito_para_arquivo') then 'arquivo' else 'recepcao' end,
        'prontuario_pendente', 'Caso encerrado, mas o prontuário ainda não voltou ao arquivo.');
    end if;
  else
    perform public._avisar(v_sol, x, 'chegou_na_fila',
      (select case when v_sol.tipo = 'pedido_receita' and e.proxima_acao_receita is not null then e.proxima_acao_receita else e.proxima_acao end
       from public.etapas e where e.etapa = v_sol.etapa))
    from unnest(public._papeis_da_etapa(v_sol.etapa)) x
    where not (x = any(public._papeis_da_etapa(v_de)) and x = v_papel);
  end if;

  perform public._auditar('transicao', 'solicitacao', p_id, v_de || ' → ' || v_t.para);
  return v_sol;
end $$;

-- ---------------------------------------------------------------- comunicação, retorno, entrega
create or replace function public.registrar_comunicacao(p_solicitacao uuid, p_canal text, p_tipo text,
  p_destinatario text default '', p_resultado text default 'registrada', p_texto text default '')
returns public.comunicacoes language plpgsql security definer set search_path = ''
as $$
declare v_c public.comunicacoes;
begin
  perform public._papel();
  if not exists (select 1 from public.solicitacoes s where s.id = p_solicitacao) then
    raise exception 'Solicitação não encontrada.' using errcode = 'P0001';
  end if;
  -- RN-12: comunicação com o paciente sem resultado não existe.
  if p_tipo = 'contato_paciente' and (coalesce(p_resultado, '') in ('', 'registrada')) then
    raise exception 'Informe o resultado do contato com o paciente.' using errcode = 'P0001';
  end if;
  insert into public.comunicacoes (solicitacao_id, canal, tipo, destinatario, ator_id, resultado, texto)
  values (p_solicitacao, p_canal, p_tipo, coalesce(p_destinatario, ''), (select auth.uid()), coalesce(p_resultado, 'registrada'), coalesce(p_texto, ''))
  returning * into v_c;
  perform public._auditar('comunicacao', 'comunicacao', p_solicitacao, p_tipo || ' — ' || v_c.resultado);
  return v_c;
end $$;

-- A decisão é do médico; o REGISTRO é da Recepção. Sem texto clínico: só o desfecho e as duas
-- assinaturas (quem decidiu: nome e registro; quem transcreveu: o token).
create or replace function public.registrar_avaliacao(p_solicitacao uuid, p_desfecho text,
  p_medico_nome text default null, p_medico_registro text default null)
returns public.avaliacoes language plpgsql security definer set search_path = ''
as $$
declare
  v_papel text := public._papel();
  v_ator uuid := (select auth.uid());
  v_sol public.solicitacoes;
  v_nome text;
  v_registro text;
  v_a public.avaliacoes;
  v_ultima public.documentos;
begin
  if v_papel <> 'recepcao' then raise exception 'Só a Recepção registra o retorno do médico.' using errcode = '42501'; end if;
  select * into v_sol from public.solicitacoes s where s.id = p_solicitacao for update;
  if not found then raise exception 'Solicitação não encontrada.' using errcode = 'P0001'; end if;
  if v_sol.etapa <> 'com_medico' then raise exception 'A solicitação não está com o médico.' using errcode = 'P0001'; end if;
  v_nome := btrim(coalesce(nullif(btrim(p_medico_nome), ''), v_sol.medico_nome, ''));
  v_registro := btrim(coalesce(nullif(btrim(p_medico_registro), ''), v_sol.medico_registro, ''));
  if v_nome = '' or v_registro = '' then
    raise exception 'Informe o nome e o registro profissional de quem decidiu.' using errcode = 'P0001';
  end if;
  insert into public.avaliacoes (solicitacao_id, desfecho, medico_nome, registro_profissional, registrado_por)
  values (p_solicitacao, p_desfecho, v_nome, v_registro, v_ator) returning * into v_a;

  if p_desfecho in ('receita_emitida', 'corrigido') then
    -- RN-15 / RF-23: correção cria NOVA VERSÃO; a anterior continua existindo.
    select * into v_ultima from public.documentos d where d.solicitacao_id = p_solicitacao order by d.versao desc limit 1;
    update public.documentos d set estado = 'substituido' where d.solicitacao_id = p_solicitacao and d.estado = 'emitido';
    insert into public.documentos (solicitacao_id, tipo, versao, substitui_id, estado, emitido_por, registrado_por, nome)
    values (p_solicitacao, 'receita', coalesce(v_ultima.versao, 0) + 1, v_ultima.id, 'emitido', v_nome, v_ator,
      format('Receita — protocolo %s%s', v_sol.protocolo,
        case when v_ultima.id is not null then format(' (v%s, corrigida)', v_ultima.versao + 1) else '' end));
  end if;
  perform public._auditar('avaliacao', 'avaliacao_medica', p_solicitacao, p_desfecho || ' — ' || v_nome);
  return v_a;
end $$;

-- RN-13 e RN-14: estados distintos, e combinação modo × estado validada.
create or replace function public.registrar_entrega(p_solicitacao uuid, p_modo text, p_estado text, p_nota text default null)
returns public.entregas language plpgsql security definer set search_path = ''
as $$
declare
  v_papel text := public._papel();
  v_ator uuid := (select auth.uid());
  v_sol public.solicitacoes;
  v_e public.entregas;
begin
  if v_papel not in ('callcenter', 'recepcao') then raise exception 'Sem permissão para esta ação.' using errcode = '42501'; end if;
  select * into v_sol from public.solicitacoes s where s.id = p_solicitacao for update;
  if not found then raise exception 'Solicitação não encontrada.' using errcode = 'P0001'; end if;
  if v_sol.tipo <> 'pedido_receita' then raise exception 'Só um pedido de receita tem entrega de documento.' using errcode = 'P0001'; end if;
  if p_estado = 'retirada_confirmada' and p_modo <> 'fisica' then
    raise exception 'Retirada confirmada só existe na entrega física.' using errcode = 'P0001';
  end if;
  if p_estado in ('anunciada', 'envio_tentado', 'enviado') and p_modo <> 'digital' then
    raise exception 'Esse estado só existe na entrega digital.' using errcode = 'P0001';
  end if;
  if p_estado = 'retirada_confirmada' and v_papel <> 'recepcao' then
    raise exception 'A confirmação da retirada é registrada pela Recepção.' using errcode = '42501';
  end if;

  select * into v_e from public.entregas e where e.solicitacao_id = p_solicitacao for update;
  if not found then
    insert into public.entregas (solicitacao_id, modo, estado) values (p_solicitacao, p_modo, 'nao_aplicavel') returning * into v_e;
  end if;
  if v_e.modo <> p_modo and exists (select 1 from public.entrega_historico h where h.entrega_id = v_e.id) then
    raise exception 'A entrega já foi registrada no outro modo. Cancele e registre de novo.' using errcode = 'P0001';
  end if;
  update public.entregas e set modo = p_modo, estado = p_estado where e.id = v_e.id returning * into v_e;
  insert into public.entrega_historico (entrega_id, estado, ator_id, nota) values (v_e.id, p_estado, v_ator, left(coalesce(p_nota, ''), 300));
  perform public._auditar('entrega', 'entrega', p_solicitacao, p_modo || ' — ' || p_estado);
  return v_e;
end $$;

-- A tarefa é da equipe a quem foi dirigida: ninguém dá por feito o trabalho de outro papel.
create or replace function public.concluir_tarefa(p_id uuid)
returns public.tarefas language plpgsql security definer set search_path = ''
as $$
declare v_papel text := public._papel(); v_t public.tarefas;
begin
  select * into v_t from public.tarefas t where t.id = p_id for update;
  if not found then raise exception 'Tarefa não encontrada.' using errcode = 'P0001'; end if;
  if v_t.papel_responsavel <> v_papel then
    raise exception 'Esta tarefa é do papel %.', public._rotulo_papel(v_t.papel_responsavel) using errcode = '42501';
  end if;
  if v_t.estado = 'concluida' then return v_t; end if;
  update public.tarefas t set estado = 'concluida', concluida_em = now() where t.id = p_id returning * into v_t;
  perform public._auditar('tarefa', 'tarefa', v_t.solicitacao_id, v_t.titulo);
  return v_t;
end $$;

create or replace function public.marcar_avisos_lidos(p_ids uuid[] default null)
returns int language plpgsql security definer set search_path = ''
as $$
declare v_papel text := public._papel(); v_n int;
begin
  update public.avisos a set lido_em = now(), lido_por = (select auth.uid())
  where a.para_papel = v_papel and a.lido_em is null and (p_ids is null or a.id = any(p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------- o relato (sensível)
create or replace function public.ler_relato(p_solicitacao uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_papel text := public._papel(); v_relato text;
begin
  if v_papel not in ('callcenter', 'recepcao') then
    raise exception 'O seu papel não lê o relato do paciente.' using errcode = '42501';
  end if;
  select r.relato into v_relato from public.solicitacao_relatos r where r.solicitacao_id = p_solicitacao;
  if not found then raise exception 'Solicitação não encontrada.' using errcode = 'P0001'; end if;
  perform public._auditar('leitura', 'relato', p_solicitacao);
  return v_relato;
end $$;

-- ---------------------------------------------------------------- configuração da clínica
create or replace function public.salvar_config(p_metas jsonb default null, p_exigir boolean default null,
  p_medicos jsonb default null, p_mensagens jsonb default null)
returns public.config_clinica language plpgsql security definer set search_path = ''
as $$
declare
  v_papel text := public._papel();
  v_cfg public.config_clinica;
  r record;
  v_limpos jsonb;
  v_nomes text[];
begin
  if v_papel <> 'admin' then raise exception 'Só a administração da clínica muda a configuração.' using errcode = '42501'; end if;
  select * into v_cfg from public.config_clinica where id = 1 for update;

  if p_medicos is not null then
    if jsonb_typeof(p_medicos) <> 'array' then raise exception 'A lista de médicos é inválida.' using errcode = 'P0001'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('nome', n, 'registro', g, 'especialidade', e)), '[]'::jsonb), coalesce(array_agg(lower(n)), '{}')
      into v_limpos, v_nomes
      from (select btrim(coalesce(m ->> 'nome', '')) n, btrim(coalesce(m ->> 'registro', '')) g, btrim(coalesce(m ->> 'especialidade', '')) e
            from jsonb_array_elements(p_medicos) m) x
      where n <> '' or g <> '';
    if exists (select 1 from jsonb_array_elements(v_limpos) m where m ->> 'nome' = '' or m ->> 'registro' = '') then
      raise exception 'Cada médico precisa de nome e registro profissional.' using errcode = 'P0001';
    end if;
    if (select count(distinct x) from unnest(v_nomes) x) <> cardinality(v_nomes) then
      raise exception 'Há dois médicos com o mesmo nome na lista.' using errcode = 'P0001';
    end if;
    v_cfg.medicos := v_limpos;
  end if;

  if p_metas is not null then
    for r in select key, value from jsonb_each(p_metas) loop
      if not exists (select 1 from public.etapas e where e.etapa = r.key) then
        raise exception 'Etapa desconhecida: %', r.key using errcode = 'P0001';
      end if;
      if jsonb_typeof(r.value) <> 'null' and (jsonb_typeof(r.value) <> 'number' or (r.value)::text::numeric <= 0 or (r.value)::text::numeric > 720) then
        raise exception 'A meta de cada etapa deve ficar entre 1 e 720 horas, ou ficar vazia.' using errcode = 'P0001';
      end if;
    end loop;
    v_cfg.metas := v_cfg.metas || p_metas;
  end if;

  if p_mensagens is not null then
    for r in select key, value from jsonb_each(p_mensagens) loop
      if r.key not in ('pedido_prontuario', 'aviso_retorno', 'aviso_receita', 'contato_paciente') then
        raise exception 'Modelo de mensagem desconhecido: %', r.key using errcode = 'P0001';
      end if;
      if jsonb_typeof(r.value) <> 'string' or btrim(r.value #>> '{}') = '' then
        raise exception 'Nenhum modelo de mensagem pode ficar vazio. Para voltar ao texto de fábrica, use "Restaurar".' using errcode = 'P0001';
      end if;
      if char_length(r.value #>> '{}') > 600 then
        raise exception 'O modelo de mensagem passou de 600 caracteres.' using errcode = 'P0001';
      end if;
    end loop;
    v_cfg.mensagens := v_cfg.mensagens || p_mensagens;
  end if;

  if p_exigir is not null then v_cfg.exigir_arquivamento_para_concluir := p_exigir; end if;

  update public.config_clinica c set metas = v_cfg.metas, medicos = v_cfg.medicos, mensagens = v_cfg.mensagens,
    exigir_arquivamento_para_concluir = v_cfg.exigir_arquivamento_para_concluir, atualizado_em = now(), atualizado_por = (select auth.uid())
  where c.id = 1 returning * into v_cfg;
  perform public._auditar('configuracao', 'configuracoes', null, 'metas de prazo, regra de conclusão, médicos e mensagens');
  return v_cfg;
end $$;

-- ---------------------------------------------------------------- quem pode chamar
do $$
declare f text;
begin
  foreach f in array array[
    'abrir_solicitacao(text, uuid, text, text)', 'assumir_solicitacao(uuid)', 'liberar_solicitacao(uuid, text)',
    'mover_prontuario(uuid, text, uuid, text)', 'mover_solicitacao(uuid, text, text, text, text, text)',
    'registrar_comunicacao(uuid, text, text, text, text, text)', 'registrar_avaliacao(uuid, text, text, text)',
    'registrar_entrega(uuid, text, text, text)', 'concluir_tarefa(uuid)', 'marcar_avisos_lidos(uuid[])',
    'ler_relato(uuid)', 'salvar_config(jsonb, boolean, jsonb, jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
