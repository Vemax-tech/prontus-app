-- PRONTUS — os dados do atendimento no Postgres, com acesso por papel imposto pelo banco.
--
-- Até aqui as solicitações, prontuários e comunicações viviam na memória do navegador
-- (js/dados.js) e as permissões só valiam na tela. Esta migration cria as tabelas e a regra de
-- QUEM LÊ O QUÊ. A regra de quem ESCREVE e em que ordem está em 0005_dados_funcoes.sql.
--
-- TRÊS PRINCÍPIOS, todos vindos do inventário LGPD (docs/lgpd/inventario-e-ripd.md):
--
--  1. NINGUÉM ESCREVE DIRETO. O papel `authenticated` só tem SELECT nestas tabelas. Toda mudança
--     passa por uma função security definer (0005) que confere papel, etapa e condições. Sem
--     INSERT/UPDATE/DELETE concedido, uma chamada direta à API é recusada antes da RLS.
--  2. SEM TEXTO CLÍNICO. A decisão do médico guarda só o desfecho, quem decidiu e quem registrou.
--     O texto da avaliação e o "resumo para o paciente" deixaram de existir. O documento emitido
--     guarda metadados e a referência do arquivo, nunca o conteúdo.
--  3. O RELATO É SENSÍVEL. O que o paciente conta ao Call Center pode citar medicamento e dose;
--     por isso mora numa tabela à parte, sem nenhum privilégio de leitura, e só é lido pela
--     função ler_relato(), que registra a leitura na auditoria.
--
-- Funções security definer sempre com `set search_path = ''`; tudo com nome qualificado.

-- ---------------------------------------------------------------- referência (o fluxo é dado)
-- Espelham js/fluxo.js. O teste tests/banco.mjs compara as duas listas linha a linha: se uma
-- mudar sem a outra, o teste falha.
create table if not exists public.etapas (
  etapa             text primary key,
  rotulo            text not null,
  papeis            text[] not null,                       -- de quem é a vez nesta etapa
  fim               boolean not null default false,
  proxima_acao      text not null,
  proxima_acao_receita text                                 -- quando o texto muda no pedido de receita
);

create table if not exists public.transicoes (
  id                 text not null,
  de                 text not null,                         -- etapa, ou '*' = qualquer etapa aberta
  para               text not null references public.etapas (etapa),
  papeis             text[] not null,
  tipos              text[],                                -- nulo = vale para os dois fluxos
  rotulo             text not null,
  exige_comunicacao  text[],
  exige_conferencia  boolean not null default false,
  exige_medico       boolean not null default false,
  exige_motivo       boolean not null default false,
  desfecho           text,
  via_prontuario     text,
  principal          boolean not null default false,
  primary key (id, de)
);

create table if not exists public.mov_validos (
  id          text primary key,
  mov         text not null,
  de          text[] not null,
  para        text not null,
  papeis      text[] not null,
  rotulo      text not null,
  exige_antes text
);

-- ---------------------------------------------------------------- dados do atendimento
create table if not exists public.pacientes (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (char_length(btrim(nome)) between 2 and 120),
  nascimento date,
  telefone   text check (telefone is null or telefone ~ '^[0-9 ()+-]{8,20}$'),
  documento  text check (documento is null or char_length(documento) <= 20),
  criado_em  timestamptz not null default now()
);

create table if not exists public.prontuarios (
  id                   uuid primary key default gen_random_uuid(),
  codigo               text not null unique check (char_length(btrim(codigo)) between 1 and 40),
  paciente_id          uuid not null unique references public.pacientes (id) on delete restrict,
  local                text not null default 'arquivo' check (local in
    ('arquivo', 'em_transito_para_recepcao', 'recepcao', 'com_medico', 'em_transito_para_arquivo', 'nao_localizado')),
  custodia_usuario_id  uuid,
  local_arquivo        text check (local_arquivo is null or char_length(local_arquivo) <= 40),
  solicitacao_id       uuid
);

create table if not exists public.solicitacoes (
  id               uuid primary key default gen_random_uuid(),
  protocolo        bigint generated always as identity (start with 1001) unique,
  tipo             text not null check (tipo in ('duvida_correcao', 'pedido_receita')),
  etapa            text not null default 'aberta' references public.etapas (etapa),
  etapa_desde      timestamptz not null default now(),
  desfecho         text check (desfecho is null or desfecho in ('resolvida', 'nao_aprovada', 'cancelada', 'sem_contato')),
  prioridade       text not null default 'normal' check (prioridade in ('alta', 'normal', 'baixa')),
  paciente_id      uuid not null references public.pacientes (id) on delete restrict,
  prontuario_id    uuid references public.prontuarios (id) on delete restrict,
  aberta_por       uuid not null,
  assumido_por     uuid,
  assumido_em      timestamptz,
  criado_em        timestamptz not null default now(),
  concluida_em     timestamptz,
  reaberturas      int not null default 0,
  motivo           text check (motivo is null or char_length(motivo) <= 200),
  medico_nome      text check (medico_nome is null or char_length(medico_nome) <= 120),
  medico_registro  text check (medico_registro is null or char_length(medico_registro) <= 40)
);
create index if not exists solicitacoes_etapa on public.solicitacoes (etapa);
create index if not exists solicitacoes_paciente on public.solicitacoes (paciente_id);
create index if not exists solicitacoes_assumido on public.solicitacoes (assumido_por) where assumido_por is not null;
alter table public.prontuarios drop constraint if exists prontuarios_solicitacao_fk;
alter table public.prontuarios add constraint prontuarios_solicitacao_fk
  foreign key (solicitacao_id) references public.solicitacoes (id) on delete set null;

-- O relato: sensível, à parte, sem privilégio de leitura (só ler_relato()).
create table if not exists public.solicitacao_relatos (
  solicitacao_id uuid primary key references public.solicitacoes (id) on delete cascade,
  relato         text not null check (char_length(btrim(relato)) between 1 and 2000)
);

create table if not exists public.eventos (
  id             uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes (id) on delete cascade,
  de_etapa       text,
  para_etapa     text,
  titulo         text check (titulo is null or char_length(titulo) <= 80),
  ator_id        uuid,
  nota           text check (nota is null or char_length(nota) <= 400),
  criado_em      timestamptz not null default now()
);
create index if not exists eventos_solicitacao on public.eventos (solicitacao_id, criado_em);

create table if not exists public.movimentos (
  id             uuid primary key default gen_random_uuid(),
  prontuario_id  uuid not null references public.prontuarios (id) on delete cascade,
  solicitacao_id uuid references public.solicitacoes (id) on delete set null,
  tipo           text not null check (tipo in ('localizado', 'retirado', 'entregue', 'recebido', 'conferido', 'encaminhado_medico',
    'devolvido_medico', 'devolvido', 'recebido_devolucao', 'arquivado', 'nao_localizado')),
  ator_id        uuid,
  nota           text check (nota is null or char_length(nota) <= 300),
  criado_em      timestamptz not null default now()
);
create index if not exists movimentos_solicitacao on public.movimentos (solicitacao_id, criado_em);
create index if not exists movimentos_prontuario on public.movimentos (prontuario_id, criado_em);

create table if not exists public.tarefas (
  id                 uuid primary key default gen_random_uuid(),
  solicitacao_id     uuid not null references public.solicitacoes (id) on delete cascade,
  papel_responsavel  text not null check (papel_responsavel in ('callcenter', 'arquivo', 'recepcao', 'admin')),
  titulo             text not null check (char_length(titulo) <= 200),
  estado             text not null default 'pendente' check (estado in ('pendente', 'concluida')),
  responsavel_id     uuid,
  criado_em          timestamptz not null default now(),
  concluida_em       timestamptz
);
create index if not exists tarefas_solicitacao on public.tarefas (solicitacao_id, estado);

create table if not exists public.comunicacoes (
  id             uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes (id) on delete cascade,
  canal          text not null check (canal in ('whatsapp_grupo', 'whatsapp', 'telefone', 'presencial', 'email')),
  tipo           text not null check (tipo in ('pedido_prontuario', 'aviso_retorno', 'aviso_receita', 'conferencia',
    'contato_paciente', 'envio_documento', 'outro')),
  destinatario   text not null default '' check (char_length(destinatario) <= 120),
  ator_id        uuid,
  resultado      text not null default 'registrada' check (resultado in ('registrada', 'falou', 'nao_atendeu',
    'numero_invalido', 'recado', 'sem_resposta', 'falhou')),
  texto          text not null default '' check (char_length(texto) <= 600),
  criado_em      timestamptz not null default now()
);
create index if not exists comunicacoes_solicitacao on public.comunicacoes (solicitacao_id, criado_em);

-- A decisão do médico SEM o texto clínico: só o desfecho e as duas assinaturas (quem decidiu e
-- quem transcreveu). Não existe coluna para conteúdo clínico, e o teste confere que continua assim.
create table if not exists public.avaliacoes (
  id                    uuid primary key default gen_random_uuid(),
  solicitacao_id        uuid not null references public.solicitacoes (id) on delete cascade,
  desfecho              text not null check (desfecho in ('receita_emitida', 'corrigido', 'respondido', 'nao_aprovado')),
  medico_nome           text not null check (char_length(btrim(medico_nome)) between 2 and 120),
  registro_profissional text not null check (char_length(btrim(registro_profissional)) between 1 and 40),
  registrado_por        uuid not null,
  criado_em             timestamptz not null default now()
);
create index if not exists avaliacoes_solicitacao on public.avaliacoes (solicitacao_id);

-- Documento emitido: metadados e a referência do arquivo. O conteúdo fica no armazenamento
-- privado (a ser ligado), nunca nesta tabela.
create table if not exists public.documentos (
  id             uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes (id) on delete cascade,
  tipo           text not null default 'receita' check (tipo in ('receita')),
  versao         int not null default 1 check (versao >= 1),
  substitui_id   uuid references public.documentos (id),
  estado         text not null default 'emitido' check (estado in ('rascunho', 'emitido', 'substituido')),
  emitido_por    text not null check (char_length(emitido_por) <= 120),
  registrado_por uuid not null,
  nome           text not null check (char_length(nome) <= 160),
  arquivo_ref    text check (arquivo_ref is null or char_length(arquivo_ref) <= 300),
  criado_em      timestamptz not null default now(),
  unique (solicitacao_id, versao)
);

create table if not exists public.entregas (
  id             uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null unique references public.solicitacoes (id) on delete cascade,
  modo           text not null check (modo in ('fisica', 'digital')),
  estado         text not null check (estado in ('nao_aplicavel', 'orientada', 'anunciada', 'envio_tentado', 'enviado',
    'retirada_confirmada', 'falha')),
  criado_em      timestamptz not null default now()
);
create table if not exists public.entrega_historico (
  id          uuid primary key default gen_random_uuid(),
  entrega_id  uuid not null references public.entregas (id) on delete cascade,
  estado      text not null,
  quando      timestamptz not null default now(),
  ator_id     uuid,
  nota        text check (nota is null or char_length(nota) <= 300)
);

create table if not exists public.avisos (
  id             uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes (id) on delete cascade,
  protocolo      bigint not null,
  etapa          text,
  para_papel     text not null check (para_papel in ('callcenter', 'arquivo', 'recepcao', 'admin')),
  tipo           text not null check (char_length(tipo) <= 40),
  texto          text not null check (char_length(texto) <= 300),
  criado_em      timestamptz not null default now(),
  lido_em        timestamptz,
  lido_por       uuid
);
create index if not exists avisos_papel on public.avisos (para_papel, criado_em desc);

-- Configuração da clínica: uma linha só. Quem lê é qualquer pessoa com perfil; quem escreve é o
-- administrador, pela função salvar_config().
create table if not exists public.config_clinica (
  id            smallint primary key default 1 check (id = 1),
  metas         jsonb not null,
  exigir_arquivamento_para_concluir boolean not null default false,
  medicos       jsonb not null default '[]'::jsonb,
  mensagens     jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);
insert into public.config_clinica (id, metas) values (1, jsonb_build_object(
  'aberta', 2, 'em_triagem', 2, 'aguardando_prontuario', 4, 'prontuario_em_transito', 2, 'prontuario_na_recepcao', 2,
  'com_medico', 2, 'aguardando_esclarecimento', 4, 'retorno_disponivel', 2, 'aguardando_contato_paciente', 6,
  'aguardando_entrega', 24, 'concluida', null, 'cancelada', null))
on conflict (id) do nothing;

-- ---------------------------------------------------------------- auditoria dos dados
-- Quem fez o quê nos dados do atendimento, inclusive LEITURA do relato. Escrita só pelas funções
-- de 0005; imutável, como auditoria_contas.
create table if not exists public.auditoria_dados (
  id             bigint generated always as identity primary key,
  quando         timestamptz not null default now(),
  ator_id        uuid,
  papel          text,
  acao           text not null,
  recurso        text not null,
  solicitacao_id uuid,                                     -- sem FK: a linha sobrevive ao caso
  detalhe        text check (detalhe is null or char_length(detalhe) <= 300)
);
create index if not exists auditoria_dados_solicitacao on public.auditoria_dados (solicitacao_id, id desc);
create index if not exists auditoria_dados_ator on public.auditoria_dados (ator_id, id desc);

create or replace function public.auditoria_dados_imutavel()
returns trigger language plpgsql set search_path = ''
as $$ begin raise exception 'A auditoria dos dados não pode ser alterada.' using errcode = 'P0001'; end $$;
revoke all on function public.auditoria_dados_imutavel() from public, anon, authenticated;
drop trigger if exists auditoria_dados_sem_alterar on public.auditoria_dados;
create trigger auditoria_dados_sem_alterar before update or delete on public.auditoria_dados
  for each row execute function public.auditoria_dados_imutavel();
drop trigger if exists auditoria_dados_sem_truncar on public.auditoria_dados;
create trigger auditoria_dados_sem_truncar before truncate on public.auditoria_dados
  for each statement execute function public.auditoria_dados_imutavel();

-- ---------------------------------------------------------------- quem LÊ o quê (RLS)
-- Espelha a matriz de js/permissoes.js. Só SELECT é concedido; escrever é por função (0005).
do $$
declare t text;
begin
  foreach t in array array['etapas', 'transicoes', 'mov_validos', 'pacientes', 'prontuarios', 'solicitacoes',
    'solicitacao_relatos', 'eventos', 'movimentos', 'tarefas', 'comunicacoes', 'avaliacoes', 'documentos',
    'entregas', 'entrega_historico', 'avisos', 'config_clinica', 'auditoria_dados']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Qualquer pessoa com perfil ativo lê: o fluxo (referência), o andamento e a configuração.
do $$
declare t text;
begin
  foreach t in array array['etapas', 'transicoes', 'mov_validos', 'prontuarios', 'solicitacoes', 'eventos',
    'movimentos', 'tarefas', 'comunicacoes', 'config_clinica']
  loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.meu_papel()) is not null)', t || '_ler', t);
  end loop;
end $$;

-- Identificação do paciente: Call Center e Recepção. Arquivo e Administrador não leem (matriz: "Vm").
grant select on public.pacientes to authenticated;
drop policy if exists pacientes_ler on public.pacientes;
create policy pacientes_ler on public.pacientes for select to authenticated
  using ((select public.meu_papel()) in ('callcenter', 'recepcao'));

-- Que existe um retorno e qual documento foi emitido: quem acompanha o caso. O Arquivo não.
do $$
declare t text;
begin
  foreach t in array array['avaliacoes', 'documentos', 'entregas']
  loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.meu_papel()) in (''callcenter'', ''recepcao'', ''admin''))', t || '_ler', t);
  end loop;
end $$;
grant select on public.entrega_historico to authenticated;
drop policy if exists entrega_historico_ler on public.entrega_historico;
create policy entrega_historico_ler on public.entrega_historico for select to authenticated
  using ((select public.meu_papel()) in ('callcenter', 'recepcao', 'admin'));

-- Aviso é para um papel: cada um lê só os da própria equipe.
grant select on public.avisos to authenticated;
drop policy if exists avisos_ler on public.avisos;
create policy avisos_ler on public.avisos for select to authenticated
  using (para_papel = (select public.meu_papel()));

-- Auditoria: só o administrador.
grant select on public.auditoria_dados to authenticated;
drop policy if exists auditoria_dados_admin on public.auditoria_dados;
create policy auditoria_dados_admin on public.auditoria_dados for select to authenticated
  using ((select public.meu_papel()) = 'admin');

-- solicitacao_relatos: sem política e sem privilégio. Só ler_relato() (security definer) chega lá.

-- ---------------------------------------------------------------- o fluxo, como dado
insert into public.etapas (etapa, rotulo, papeis, fim, proxima_acao, proxima_acao_receita) values
  ('aberta', 'Aberta', '{callcenter}', false, 'Registrar o pedido e avisar o arquivo para localizar o prontuário.', null),
  ('em_triagem', 'Em triagem', '{callcenter}', false, 'Concluir a triagem e pedir o prontuário.', null),
  ('aguardando_prontuario', 'Aguardando prontuário', '{arquivo}', false, 'Localizar o prontuário, retirar e entregar à Recepção.', null),
  ('prontuario_em_transito', 'Prontuário em trânsito', '{recepcao}', false, 'Confirmar o recebimento do prontuário.', null),
  ('prontuario_na_recepcao', 'Prontuário na Recepção', '{recepcao}', false, 'Conferir o prontuário e levar o caso ao médico.', null),
  ('com_medico', 'Com o médico', '{recepcao}', false, 'Buscar a resposta com o médico e registrá-la no sistema.', null),
  ('aguardando_esclarecimento', 'Aguardando esclarecimento', '{callcenter,recepcao}', false, 'Prestar o esclarecimento pedido pelo médico.', null),
  ('retorno_disponivel', 'Retorno disponível', '{recepcao}', false, 'Avisar no grupo que o retorno está disponível.', null),
  ('aguardando_contato_paciente', 'Aguardando contato com o paciente', '{callcenter}', false,
    'Comunicar a resposta do médico ao paciente.', 'Avisar o paciente que a receita está pronta.'),
  ('aguardando_entrega', 'Aguardando entrega', '{callcenter,recepcao}', false, 'Registrar a entrega conforme o resultado real.', null),
  ('concluida', 'Concluída', '{}', true, 'Nada. Caso concluído.', null),
  ('cancelada', 'Cancelada', '{}', true, 'Nada. Caso cancelado.', null)
on conflict (etapa) do update set rotulo = excluded.rotulo, papeis = excluded.papeis, fim = excluded.fim,
  proxima_acao = excluded.proxima_acao, proxima_acao_receita = excluded.proxima_acao_receita;

insert into public.transicoes (id, de, para, papeis, tipos, rotulo, exige_comunicacao, exige_conferencia, exige_medico, exige_motivo, desfecho, via_prontuario, principal) values
  ('T02', 'aberta', 'em_triagem', '{callcenter}', null, 'Classificar (triagem)', null, false, false, false, null, null, false),
  ('T03', 'aberta', 'aguardando_prontuario', '{callcenter}', null, 'Pedir prontuário ao arquivo', '{pedido_prontuario}', false, false, false, null, null, true),
  ('T03', 'em_triagem', 'aguardando_prontuario', '{callcenter}', null, 'Pedir prontuário ao arquivo', '{pedido_prontuario}', false, false, false, null, null, true),
  ('T04', 'aguardando_prontuario', 'prontuario_em_transito', '{arquivo}', null, 'Entregar à Recepção', null, false, false, false, null, 'entregue', true),
  ('T05', 'prontuario_em_transito', 'prontuario_na_recepcao', '{recepcao}', null, 'Confirmar recebimento', null, false, false, false, null, 'recebido', true),
  ('T06', 'prontuario_na_recepcao', 'com_medico', '{recepcao}', null, 'Levar ao médico', null, true, true, false, null, null, true),
  ('T07', 'com_medico', 'retorno_disponivel', '{recepcao}', null, 'Registrar o retorno', null, false, false, false, null, null, true),
  ('T08', 'com_medico', 'aguardando_esclarecimento', '{recepcao}', null, 'Médico pediu esclarecimento', null, false, false, false, null, null, false),
  ('T09', 'aguardando_esclarecimento', 'com_medico', '{callcenter,recepcao}', null, 'Prestar o esclarecimento', null, false, false, false, null, null, true),
  ('T10', 'retorno_disponivel', 'aguardando_contato_paciente', '{recepcao}', null, 'Avisar no grupo', '{aviso_retorno,aviso_receita}', false, false, false, null, null, true),
  ('T11', 'aguardando_contato_paciente', 'concluida', '{callcenter}', '{duvida_correcao}', 'Concluir: dúvida esclarecida', null, false, false, false, 'resolvida', null, true),
  ('T12', 'aguardando_contato_paciente', 'aguardando_entrega', '{callcenter}', '{pedido_receita}', 'Paciente avisado: definir entrega', null, false, false, false, null, null, true),
  ('T13', 'aguardando_entrega', 'concluida', '{callcenter,recepcao}', '{pedido_receita}', 'Concluir: entrega registrada', null, false, false, false, 'resolvida', null, true),
  ('T14', 'com_medico', 'concluida', '{recepcao}', '{pedido_receita}', 'Médico não aprovou o pedido', null, false, false, false, 'nao_aprovada', null, false),
  ('T16', 'concluida', 'aberta', '{callcenter,admin}', null, 'Reabrir', null, false, false, true, null, null, false),
  ('T15', '*', 'cancelada', '{callcenter,admin}', null, 'Cancelar', null, false, false, true, 'cancelada', null, false)
on conflict (id, de) do update set para = excluded.para, papeis = excluded.papeis, tipos = excluded.tipos, rotulo = excluded.rotulo,
  exige_comunicacao = excluded.exige_comunicacao, exige_conferencia = excluded.exige_conferencia, exige_medico = excluded.exige_medico,
  exige_motivo = excluded.exige_motivo, desfecho = excluded.desfecho, via_prontuario = excluded.via_prontuario, principal = excluded.principal;

insert into public.mov_validos (id, mov, de, para, papeis, rotulo, exige_antes) values
  ('C01', 'localizado', '{arquivo,nao_localizado}', 'arquivo', '{arquivo}', 'Registrar que localizou', null),
  ('C02', 'retirado', '{arquivo}', 'arquivo', '{arquivo}', 'Registrar retirada', 'localizado'),
  ('C03', 'entregue', '{arquivo}', 'em_transito_para_recepcao', '{arquivo}', 'Entregar à Recepção', 'retirado'),
  ('C04', 'recebido', '{em_transito_para_recepcao}', 'recepcao', '{recepcao}', 'Confirmar recebimento', null),
  ('C04b', 'conferido', '{recepcao}', 'recepcao', '{recepcao}', 'Registrar conferência', null),
  ('C05', 'encaminhado_medico', '{recepcao}', 'com_medico', '{recepcao}', 'Levar ao médico', null),
  ('C06', 'devolvido_medico', '{com_medico}', 'recepcao', '{recepcao}', 'Receber de volta do médico', null),
  ('C07', 'devolvido', '{recepcao}', 'em_transito_para_arquivo', '{recepcao}', 'Devolver ao arquivo', null),
  ('C08', 'recebido_devolucao', '{em_transito_para_arquivo}', 'arquivo', '{arquivo}', 'Confirmar devolução recebida', null),
  ('C09', 'arquivado', '{arquivo}', 'arquivo', '{arquivo}', 'Arquivar', 'recebido_devolucao'),
  ('C10', 'nao_localizado', '{arquivo}', 'nao_localizado', '{arquivo}', 'Não encontrei o prontuário', null)
on conflict (id) do update set mov = excluded.mov, de = excluded.de, para = excluded.para, papeis = excluded.papeis,
  rotulo = excluded.rotulo, exige_antes = excluded.exige_antes;

notify pgrst, 'reload schema';
