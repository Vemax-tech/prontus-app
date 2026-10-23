// Teste dos dados do atendimento NO BANCO: quem lê o quê (RLS), quem escreve e em que ordem
// (funções), e a auditoria. Nada é simulado: as chamadas passam pelo PostgREST com o token de uma
// pessoa de cada papel, contra o Postgres da stack local (a mesma de tests/auth.mjs).
//
// Pré-requisito:  cd supabase/local && docker compose up -d && cd ../.. && node supabase/local/preparar.mjs
// Rodar:          npm run test:banco
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { anonKey, servicoKey, CONTAS, SENHA_LOCAL, URL_LOCAL } from '../supabase/local/contas.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const falhas = [];
const check = (c, m) => { if (!c) { falhas.push(m); console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const F = await import(pathToFileURL(path.join(REPO, 'js/fluxo.js')).href);

try { await fetch(URL_LOCAL + '/auth/v1/health'); } catch {
  console.log('✗ A stack local não está no ar. Rode: cd supabase/local && docker compose up -d && cd ../.. && node supabase/local/preparar.mjs');
  process.exit(1);
}

// ---------------------------------------------------------------- ferramentas
const psqlBruto = (sql) => spawnSync('docker', ['exec', 'prontus-auth-db-1', 'psql', '-U', 'postgres', '-d', 'prontus', '-t', '-A', '-c', sql], { encoding: 'utf8' });
const psql = (sql) => psqlBruto(sql).stdout.trim();
const json = (sql) => JSON.parse(psql(sql) || 'null');

async function entrarComo(email) {
  const r = await fetch(URL_LOCAL + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { apikey: anonKey, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: SENHA_LOCAL }),
  });
  const t = await r.json();
  return { token: t.access_token, id: t.user?.id };
}
const chamar = async (quem, caminho, { metodo = 'GET', corpo } = {}) => {
  const r = await fetch(URL_LOCAL + '/rest/v1/' + caminho, {
    method: metodo,
    headers: { apikey: anonKey, authorization: `Bearer ${quem?.token || anonKey}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const rpc = (quem, fn, args = {}) => chamar(quem, 'rpc/' + fn, { metodo: 'POST', corpo: args });
const ler = (quem, tabela, consulta = '') => chamar(quem, tabela + (consulta ? '?' + consulta : ''));
const msg = (r) => String(r.json?.message || '');
const recusou = (r, codigo) => r.status >= 400 && (!codigo || r.json?.code === codigo);

// ---------------------------------------------------------------- contas e fixtures
const marco = Number(psql('select coalesce(max(id), 0) from public.auditoria_dados')) || 0;
const metasOriginais = psql("select metas::text from public.config_clinica where id = 1");
const medicosOriginais = psql("select medicos::text from public.config_clinica where id = 1");

const eu = {};
for (const [email, , , papel] of CONTAS) eu[papel] = await entrarComo(email);
const sufixo = Date.now().toString(36);

// Segundo Call Center (para posse concorrente e "já assumiu").
const emailCc2 = `cc2-${sufixo}@prontus.local`;
const cc2Conta = await (await fetch(URL_LOCAL + '/auth/v1/admin/users', {
  method: 'POST', headers: { apikey: anonKey, authorization: `Bearer ${servicoKey}`, 'content-type': 'application/json' },
  body: JSON.stringify({ email: emailCc2, password: SENHA_LOCAL, email_confirm: true }),
})).json();
psql(`insert into public.perfis (id, nome, cargo, papel) values ('${cc2Conta.id}', 'Segundo Atendente', 'Atendente', 'callcenter')`);
const cc2 = await entrarComo(emailCc2);

const idPac = [1, 2, 3].map(() => psql('select gen_random_uuid()'));
idPac.forEach((id, i) => {
  psql(`insert into public.pacientes (id, nome, nascimento, telefone) values ('${id}', 'Paciente Teste ${i + 1}', '1950-01-0${i + 1}', '(11) 90000-000${i + 1}')`);
  psql(`insert into public.prontuarios (codigo, paciente_id, local_arquivo) values ('T-${sufixo}-${i + 1}', '${id}', 'Z-${i + 1}')`);
});
const prontDe = (i) => psql(`select id from public.prontuarios where paciente_id = '${idPac[i]}'`);
const solsCriadas = [];

// ================================================================ 1. o esquema
console.log('\n## Esquema: o que NÃO existe');
const colunas = (t) => json(`select coalesce(json_agg(column_name), '[]') from information_schema.columns where table_schema='public' and table_name='${t}'`);
check(!colunas('avaliacoes').some((c) => /clinic|resumo|conteudo|texto/i.test(c)), 'a avaliação do médico não tem coluna de texto clínico nem de resumo');
check(!colunas('documentos').some((c) => /conteudo|corpo|texto|pdf/i.test(c)), 'o documento guarda metadados e referência, nunca o conteúdo');
const escritas = json(`select coalesce(json_agg(table_name || ':' || privilege_type), '[]') from information_schema.role_table_grants
  where table_schema='public' and grantee in ('authenticated','anon') and privilege_type <> 'SELECT'
  and table_name in ('etapas','transicoes','mov_validos','pacientes','prontuarios','solicitacoes','solicitacao_relatos','eventos','movimentos','tarefas','comunicacoes','avaliacoes','documentos','entregas','entrega_historico','avisos','config_clinica','auditoria_dados')`);
check(escritas.length === 0, `nenhuma tabela de dados concede INSERT/UPDATE/DELETE a quem tem login${escritas.length ? ' (' + escritas.join(', ') + ')' : ''}`);
const relatoGrants = json(`select coalesce(json_agg(grantee), '[]') from information_schema.role_table_grants where table_schema='public' and table_name='solicitacao_relatos' and grantee in ('authenticated','anon')`);
check(relatoGrants.length === 0, 'o relato do paciente não tem privilégio nenhum para quem tem login (só ler_relato())');
const anonVe = json(`select coalesce(json_agg(table_name), '[]') from information_schema.role_table_grants where table_schema='public' and grantee='anon'
  and table_name in ('pacientes','prontuarios','solicitacoes','avaliacoes','documentos','comunicacoes','config_clinica')`);
check(anonVe.length === 0, 'quem não fez login não lê nenhuma tabela de dados');

// ================================================================ 2. espelho de js/fluxo.js
console.log('\n## O fluxo no banco é o mesmo de js/fluxo.js');
const iguais = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const dbEtapas = json("select coalesce(json_agg(e), '[]') from public.etapas e");
check(dbEtapas.length === Object.keys(F.ETAPAS).length, `as ${dbEtapas.length} etapas existem, nem mais nem menos`);
let etapasOk = true;
for (const [chave, rotulo] of Object.entries(F.ETAPAS)) {
  const l = dbEtapas.find((e) => e.etapa === chave);
  const duv = F.proximaAcao({ etapa: chave, tipo: 'duvida_correcao' });
  const rec = F.proximaAcao({ etapa: chave, tipo: 'pedido_receita' });
  if (!l || l.rotulo !== rotulo || l.fim !== F.ETAPAS_FIM.includes(chave) || !iguais(l.papeis, duv.papeis)
      || l.proxima_acao !== duv.texto || (l.proxima_acao_receita ?? l.proxima_acao) !== rec.texto) { etapasOk = false; console.log('    diverge: etapa ' + chave); }
}
check(etapasOk, 'rótulo, vez de cada equipe e próxima ação de cada etapa batem');

const dbTrans = json("select coalesce(json_agg(t), '[]') from public.transicoes t");
const esperadas = [...F.TRANSICOES, { ...F.CANCELAR, de: '*' }];
check(dbTrans.length === esperadas.length, `as ${esperadas.length} transições existem (T15, cancelar, vale de qualquer etapa aberta)`);
let transOk = true;
for (const t of esperadas) {
  const l = dbTrans.find((x) => x.id === t.id && x.de === t.de);
  const ok = l && l.para === t.para && iguais(l.papeis, t.papeis) && iguais(l.tipos || [], t.tipos || [])
    && l.rotulo === t.rotulo && Boolean(l.exige_conferencia) === Boolean(t.exigeConferencia) && Boolean(l.exige_medico) === Boolean(t.exigeMedico)
    && Boolean(l.exige_motivo) === Boolean(t.exigeMotivo) && (l.desfecho || null) === (t.desfecho || null)
    && (l.via_prontuario || null) === (t.viaProntuario || null) && Boolean(l.principal) === Boolean(t.principal)
    && ((l.exige_comunicacao || []).length > 0) === Boolean(t.exigeComunicacao)
    && (!t.exigeComunicacao || l.exige_comunicacao.includes(t.exigeComunicacao));
  if (!ok) { transOk = false; console.log(`    diverge: ${t.id} de ${t.de}`); }
}
check(transOk, 'cada transição tem o mesmo destino, papéis, tipos, exigências e desfecho');

const dbMov = json("select coalesce(json_agg(m), '[]') from public.mov_validos m");
check(dbMov.length === F.MOV_VALIDOS.length, `os ${F.MOV_VALIDOS.length} movimentos de custódia existem`);
check(F.MOV_VALIDOS.every((m) => {
  const l = dbMov.find((x) => x.id === m.id);
  return l && l.mov === m.mov && iguais(l.de, m.de) && l.para === m.para && iguais(l.papeis, m.papeis) && l.rotulo === m.rotulo && (l.exige_antes || null) === (m.exigeAntes || null);
}), 'e cada um bate com js/fluxo.js');

// ================================================================ 3. recusas por papel
console.log('\n## Quem não é do papel é recusado');
let r = await rpc(eu.arquivo, 'abrir_solicitacao', { p_tipo: 'pedido_receita', p_paciente: idPac[0], p_relato: 'x' });
check(recusou(r, '42501'), 'o Arquivo não abre solicitação');
r = await rpc(eu.admin, 'abrir_solicitacao', { p_tipo: 'pedido_receita', p_paciente: idPac[0], p_relato: 'x' });
check(recusou(r, '42501'), 'o Administrador também não');
r = await rpc(null, 'abrir_solicitacao', { p_tipo: 'pedido_receita', p_paciente: idPac[0], p_relato: 'x' });
check(r.status >= 400, 'sem login a função nem executa');
const internas = [['_auditar', { p_acao: 'forjada', p_recurso: 'x', p_sol: null }], ['_evento', { p_sol: idPac[0], p_de: null, p_para: 'x', p_titulo: null, p_nota: 'x' }],
  ['_assumir_se_livre', { p_sol: idPac[0], p_papel: 'callcenter' }], ['_papel', {}]];
let forjou = false;
for (const papel of ['callcenter', 'arquivo', 'recepcao', 'admin']) for (const [fn, args] of internas) if ((await rpc(eu[papel], fn, args)).status < 400) forjou = true;
check(!forjou && psql("select count(*) from public.auditoria_dados where acao = 'forjada'") === '0', 'as funções internas (inclusive a que grava a auditoria) não são chamáveis de fora: ninguém forja uma linha');

// ================================================================ 4. o fluxo inteiro, passo a passo
console.log('\n## Pedido de receita, da ligação à entrega, cada passo pelo papel certo');
r = await rpc(eu.callcenter, 'abrir_solicitacao', { p_tipo: 'pedido_receita', p_paciente: idPac[0], p_relato: 'Pede renovação da receita de uso contínuo.' });
const sol = r.json;
solsCriadas.push(sol?.id);
check(r.status === 200 && sol.etapa === 'aberta' && sol.assumido_por === eu.callcenter.id && sol.protocolo >= 1001, `o Call Center abre; o caso já nasce com ele (protocolo ${sol?.protocolo})`);
check(psql(`select count(*) from public.tarefas where solicitacao_id='${sol.id}' and estado='pendente'`) === '1', 'nasce a tarefa "Pedir o prontuário ao arquivo"');
const estado = (id = sol.id) => json(`select row_to_json(s) from public.solicitacoes s where id='${id}'`);

r = await rpc(eu.callcenter, 'mover_solicitacao', { p_id: sol.id, p_transicao: 'T03' });
check(recusou(r, 'P0001') && /Registre o aviso/.test(msg(r)), 'pedir o prontuário sem registrar o aviso no grupo é recusado');
r = await rpc(eu.callcenter, 'registrar_comunicacao', { p_solicitacao: sol.id, p_canal: 'whatsapp_grupo', p_tipo: 'pedido_prontuario', p_destinatario: 'Grupo operacional', p_resultado: 'registrada', p_texto: `Protocolo ${sol.protocolo} — localizar o prontuário.` });
check(r.status === 200, 'o aviso ao arquivo é registrado');
r = await rpc(eu.callcenter, 'mover_solicitacao', { p_id: sol.id, p_transicao: 'T03' });
check(r.status === 200 && r.json.etapa === 'aguardando_prontuario' && r.json.assumido_por === null, 'agora avança, e o caso fica sem dono na fila do Arquivo');
check(psql(`select count(*) from public.avisos where solicitacao_id='${sol.id}' and para_papel='arquivo' and tipo='chegou_na_fila'`) === '1', 'o Arquivo recebe o aviso de que o caso chegou');
check(psql(`select count(*) from public.avisos where solicitacao_id='${sol.id}' and para_papel='callcenter'`) === '0', 'e o Call Center, que acabou de agir, não');

r = await rpc(eu.recepcao, 'mover_solicitacao', { p_id: sol.id, p_transicao: 'T04' });
check(recusou(r, '42501'), 'a Recepção não faz o passo do Arquivo (T04)');
r = await rpc(eu.arquivo, 'mover_prontuario', { p_prontuario: prontDe(0), p_mov: 'entregue', p_solicitacao: sol.id });
check(recusou(r, 'P0001') && /passo anterior/.test(msg(r)), 'entregar a pasta sem tê-la retirado é recusado');
r = await rpc(eu.arquivo, 'mover_prontuario', { p_prontuario: prontDe(0), p_mov: 'recebido', p_solicitacao: sol.id });
check(recusou(r, '42501') && /Recepção/.test(msg(r)), 'o Arquivo não confirma recebimento: "é do papel Recepção"');
for (const m of ['localizado', 'retirado']) {
  r = await rpc(eu.arquivo, 'mover_prontuario', { p_prontuario: prontDe(0), p_mov: m, p_solicitacao: sol.id });
  check(r.status === 200, `o Arquivo registra "${m}"`);
}
check(estado().assumido_por === eu.arquivo.id, 'agir é assumir: quem mexeu na pasta vira o dono do caso');
r = await rpc(eu.arquivo, 'mover_solicitacao', { p_id: sol.id, p_transicao: 'T04' });
check(r.status === 200 && r.json.etapa === 'prontuario_em_transito', 'T04: a etapa e a pasta andam juntas');
check(psql(`select local from public.prontuarios where id='${prontDe(0)}'`) === 'em_transito_para_recepcao', 'e a custódia mostra a pasta em trânsito para a Recepção');
check(psql(`select count(*) from public.movimentos where solicitacao_id='${sol.id}' and tipo='entregue'`) === '1', 'com um só registro de "entregue" (o passo não duplica o movimento)');

r = await rpc(eu.recepcao, 'mover_solicitacao', { p_id: sol.id, p_transicao: 'T05' });
check(r.status === 200 && r.json.etapa === 'prontuario_na_recepcao', 'T05: a Recepção confirma o recebimento');
r = await rpc(eu.recepcao, 'mover_solicitacao', { p_id: sol.id, p_transicao: 'T06', p_medico_nome: 'Dr. Paulo Aragão', p_medico_registro: 'CRM 1' });
check(recusou(r, 'P0001') && /conferência/.test(msg(r)), 'levar ao médico sem conferir a pasta é recusado');
await rpc(eu.recepcao, 'mover_prontuario', { p_prontuario: prontDe(0), p_mov: 'conferido', p_solicitacao: sol.id });
r = await rpc(eu.recepcao, 'mover_solicitacao', { p_id: sol.id, p_transicao: 'T06' });
check(recusou(r, 'P0001') && /qual médico/.test(msg(r)), 'e sem dizer a qual médico também');
r = await rpc(eu.recepcao, 'mover_solicitacao', { p_id: sol.id, p_transicao: 'T06', p_medico_nome: 'Dr. Paulo Aragão', p_medico_registro: 'CRM 1' });
check(r.status === 200 && r.json.etapa === 'com_medico' && r.json.medico_nome === 'Dr. Paulo Aragão', 'T06: o caso vai ao médico, com o nome de quem o recebeu');

r = await rpc(eu.callcenter, 'registrar_avaliacao', { p_solicitacao: sol.id, p_desfecho: 'receita_emitida' });
check(recusou(r, '42501'), 'só a Recepção registra o retorno do médico');
r = await rpc(eu.recepcao, 'registrar_avaliacao', { p_solicitacao: sol.id, p_desfecho: 'receita_emitida' });
check(r.status === 200 && r.json.registrado_por === eu.recepcao.id && r.json.registro_profissional === 'CRM 1', 'a Recepção registra: assina quem decidiu e quem digitou');
check(psql(`select count(*) from public.documentos where solicitacao_id='${sol.id}' and estado='emitido' and versao=1`) === '1', 'a receita emitida vira o documento versão 1');
r = await rpc(eu.recepcao, 'mover_solicitacao', { p_id: sol.id, p_transicao: 'T07' });
check(r.status === 200 && r.json.etapa === 'retorno_disponivel', 'T07: retorno disponível');
await rpc(eu.recepcao, 'registrar_comunicacao', { p_solicitacao: sol.id, p_canal: 'whatsapp_grupo', p_tipo: 'aviso_receita', p_destinatario: 'Grupo operacional', p_resultado: 'registrada', p_texto: 'receita pronta' });
r = await rpc(eu.recepcao, 'mover_solicitacao', { p_id: sol.id, p_transicao: 'T10' });
check(r.status === 200 && r.json.etapa === 'aguardando_contato_paciente', 'T10: aviso publicado, a vez passa ao Call Center');

r = await rpc(eu.callcenter, 'mover_solicitacao', { p_id: sol.id, p_transicao: 'T12' });
check(r.status === 200 && r.json.etapa === 'aguardando_entrega', 'T12: paciente avisado, definir a entrega');
r = await rpc(eu.callcenter, 'mover_solicitacao', { p_id: sol.id, p_transicao: 'T13' });
check(recusou(r, 'P0001') && /contato efetivo/.test(msg(r)), 'concluir sem contato efetivo com o paciente é recusado');
r = await rpc(eu.callcenter, 'registrar_comunicacao', { p_solicitacao: sol.id, p_canal: 'telefone', p_tipo: 'contato_paciente', p_destinatario: 'Paciente', p_resultado: 'registrada' });
check(recusou(r, 'P0001') && /resultado do contato/.test(msg(r)), 'contato com o paciente sem resultado não existe');
r = await rpc(eu.callcenter, 'registrar_comunicacao', { p_solicitacao: sol.id, p_canal: 'telefone', p_tipo: 'contato_paciente', p_destinatario: 'Paciente', p_resultado: 'nao_atendeu' });
r = await rpc(eu.callcenter, 'mover_solicitacao', { p_id: sol.id, p_transicao: 'T13' });
check(recusou(r, 'P0001') && /contato efetivo/.test(msg(r)), 'tentativa sem sucesso não conta como contato');
await rpc(eu.callcenter, 'registrar_comunicacao', { p_solicitacao: sol.id, p_canal: 'telefone', p_tipo: 'contato_paciente', p_destinatario: 'Paciente', p_resultado: 'falou' });
r = await rpc(eu.callcenter, 'mover_solicitacao', { p_id: sol.id, p_transicao: 'T13' });
check(recusou(r, 'P0001') && /entrega/.test(msg(r)), 'sem a entrega registrada, não conclui');
r = await rpc(eu.callcenter, 'registrar_entrega', { p_solicitacao: sol.id, p_modo: 'fisica', p_estado: 'retirada_confirmada' });
check(recusou(r, '42501'), 'o Call Center não confirma a retirada física (é da Recepção)');
r = await rpc(eu.callcenter, 'registrar_entrega', { p_solicitacao: sol.id, p_modo: 'fisica', p_estado: 'enviado' });
check(recusou(r, 'P0001') && /digital/.test(msg(r)), '"enviado" não existe na entrega física');
await rpc(eu.callcenter, 'registrar_entrega', { p_solicitacao: sol.id, p_modo: 'fisica', p_estado: 'orientada' });
r = await rpc(eu.callcenter, 'mover_solicitacao', { p_id: sol.id, p_transicao: 'T13' });
check(recusou(r, 'P0001') && /ainda não foi confirmada/.test(msg(r)), 'entrega só orientada não basta');
r = await rpc(eu.recepcao, 'registrar_entrega', { p_solicitacao: sol.id, p_modo: 'fisica', p_estado: 'retirada_confirmada' });
check(r.status === 200, 'a Recepção confirma a retirada');
r = await rpc(eu.callcenter, 'mover_solicitacao', { p_id: sol.id, p_transicao: 'T13' });
check(r.status === 200 && r.json.etapa === 'concluida' && r.json.desfecho === 'resolvida' && r.json.concluida_em, 'T13: conclui, com desfecho e hora');
check(psql(`select count(*) from public.tarefas where solicitacao_id='${sol.id}' and estado='pendente'`) === '0', 'as tarefas pendentes se encerram junto');
check(psql(`select count(*) from public.avisos where solicitacao_id='${sol.id}' and tipo='prontuario_pendente' and para_papel='recepcao'`) === '1', 'a pasta ainda está na Recepção: o aviso de pendência vai para ela');
check(Number(psql(`select count(*) from public.eventos where solicitacao_id='${sol.id}'`)) === 9, 'a linha do tempo registrou a abertura e cada uma das 8 transições');
r = await rpc(eu.callcenter, 'mover_solicitacao', { p_id: sol.id, p_transicao: 'T13' });
check(recusou(r, '42501'), 'caso concluído não repete a transição');

// ================================================================ 5. posse, cancelamento e reabertura
console.log('\n## Posse, cancelar e reabrir');
r = await rpc(eu.callcenter, 'abrir_solicitacao', { p_tipo: 'duvida_correcao', p_paciente: idPac[1], p_relato: 'Dosagem ilegível na receita.', p_prioridade: 'alta' });
const sol2 = r.json; solsCriadas.push(sol2?.id);
check(r.status === 200 && sol2.prioridade === 'alta', 'segunda solicitação aberta (dúvida, prioridade alta)');
r = await rpc(cc2, 'assumir_solicitacao', { p_id: sol2.id });
check(recusou(r, 'P0001') && /já assumiu/.test(msg(r)) && /Aline Barros/.test(msg(r)), 'outra pessoa não assume um caso que já tem dono');
r = await rpc(eu.recepcao, 'liberar_solicitacao', { p_id: sol2.id });
check(recusou(r, '42501'), 'quem não assumiu nem coordena não libera');
r = await rpc(eu.arquivo, 'assumir_solicitacao', { p_id: sol2.id });
check(recusou(r, '42501') && /Call Center/.test(msg(r)), 'o Arquivo não assume uma etapa que é do Call Center');
r = await rpc(cc2, 'liberar_solicitacao', { p_id: sol2.id, p_motivo: 'Aline saiu de turno' });
check(r.status === 200 && r.json.assumido_por === null, 'a coordenação libera para destravar');
const disputa = await Promise.all([rpc(eu.callcenter, 'assumir_solicitacao', { p_id: sol2.id }), rpc(cc2, 'assumir_solicitacao', { p_id: sol2.id })]);
check(disputa.filter((x) => x.status === 200).length === 1 && disputa.filter((x) => x.status >= 400).length === 1, 'duas pessoas assumindo ao mesmo tempo: só uma fica com o caso');
check([eu.callcenter.id, cc2.id].includes(estado(sol2.id).assumido_por), 'e o dono gravado é um dos dois');

r = await rpc(eu.callcenter, 'mover_solicitacao', { p_id: sol2.id, p_transicao: 'T15' });
check(recusou(r, 'P0001') && /motivo/.test(msg(r)), 'cancelar exige o motivo');
r = await rpc(eu.arquivo, 'mover_solicitacao', { p_id: sol2.id, p_transicao: 'T15', p_motivo: 'x' });
check(recusou(r, '42501'), 'o Arquivo não cancela solicitação');
r = await rpc(eu.admin, 'mover_solicitacao', { p_id: sol2.id, p_transicao: 'T15', p_motivo: 'Paciente desistiu' });
check(r.status === 200 && r.json.etapa === 'cancelada' && r.json.desfecho === 'cancelada' && r.json.motivo === 'Paciente desistiu', 'o Administrador cancela, com motivo');
r = await rpc(eu.admin, 'mover_solicitacao', { p_id: sol2.id, p_transicao: 'T16', p_motivo: 'Paciente voltou' });
check(recusou(r, '42501'), 'cancelada não reabre (T16 é só de concluída)');
r = await rpc(eu.admin, 'mover_solicitacao', { p_id: sol.id, p_transicao: 'T16', p_motivo: 'Faltou uma assinatura' });
check(r.status === 200 && r.json.etapa === 'aberta' && r.json.reaberturas === 1 && r.json.desfecho === null, 'o Administrador reabre a concluída (histórico preservado: 1 reabertura)');

// ================================================================ 6. quem LÊ o quê
console.log('\n## Leitura por papel (RLS)');
const linhas = async (quem, tabela, consulta = '') => { const x = await ler(quem, tabela, consulta); return x.status === 200 && Array.isArray(x.json) ? x.json.length : -1; };
check((await linhas(eu.callcenter, 'pacientes')) >= 3 && (await linhas(eu.recepcao, 'pacientes')) >= 3, 'Call Center e Recepção leem a identificação do paciente');
check((await linhas(eu.arquivo, 'pacientes')) === 0 && (await linhas(eu.admin, 'pacientes')) === 0, 'Arquivo e Administrador não leem nome, telefone nem documento');
check((await linhas(eu.arquivo, 'solicitacoes', `id=eq.${sol.id}`)) === 1, 'o Arquivo vê a solicitação (precisa dela para a pasta)...');
check((await linhas(eu.arquivo, 'avaliacoes')) === 0 && (await linhas(eu.arquivo, 'documentos')) === 0 && (await linhas(eu.arquivo, 'entregas')) === 0, '...mas não o retorno do médico, os documentos nem a entrega');
check((await linhas(eu.admin, 'avaliacoes', `solicitacao_id=eq.${sol.id}`)) === 1 && (await linhas(eu.callcenter, 'avaliacoes', `solicitacao_id=eq.${sol.id}`)) === 1, 'Administrador e Call Center sabem que o retorno existe');
check((await linhas(eu.callcenter, 'documentos', `solicitacao_id=eq.${sol.id}`)) === 1, 'e veem os metadados do documento');
const avaliacaoVista = (await ler(eu.callcenter, 'avaliacoes', `solicitacao_id=eq.${sol.id}`)).json[0];
check(avaliacaoVista && Object.keys(avaliacaoVista).every((k) => !/clinic|resumo|conteudo|texto/i.test(k)), 'e o que veem não contém texto clínico algum');
check((await linhas(eu.arquivo, 'prontuarios')) >= 3 && (await linhas(eu.admin, 'prontuarios')) >= 3, 'a custódia do prontuário é visível a todos os papéis');
check((await linhas(eu.callcenter, 'config_clinica')) === 1 && (await linhas(eu.arquivo, 'transicoes')) === esperadas.length, 'configuração e fluxo são legíveis por quem tem perfil');

console.log('\n## O relato do paciente (sensível)');
r = await ler(eu.callcenter, 'solicitacao_relatos');
check(recusou(r), 'ninguém lê a tabela do relato pela API, nem o Call Center');
r = await rpc(eu.callcenter, 'ler_relato', { p_solicitacao: sol.id });
check(r.status === 200 && /renovação da receita/.test(r.json), 'o Call Center lê o relato pela função');
r = await rpc(eu.recepcao, 'ler_relato', { p_solicitacao: sol.id });
check(r.status === 200, 'a Recepção também');
r = await rpc(eu.arquivo, 'ler_relato', { p_solicitacao: sol.id });
check(recusou(r, '42501'), 'o Arquivo não');
r = await rpc(eu.admin, 'ler_relato', { p_solicitacao: sol.id });
check(recusou(r, '42501'), 'e o Administrador, que não ganha acesso por administrar, também não');
const leituras = json(`select coalesce(json_agg(papel order by id), '[]') from public.auditoria_dados where solicitacao_id='${sol.id}' and acao='leitura' and recurso='relato'`);
check(iguais(leituras, ['callcenter', 'recepcao']), 'as duas leituras que valeram ficaram na auditoria, com o papel de quem leu');

console.log('\n## Escrita direta é recusada');
const alvos = [
  ['solicitacoes', { tipo: 'pedido_receita', paciente_id: idPac[0], aberta_por: eu.callcenter.id }],
  ['comunicacoes', { solicitacao_id: sol.id, canal: 'telefone', tipo: 'outro' }],
  ['tarefas', { solicitacao_id: sol.id, papel_responsavel: 'callcenter', titulo: 'x' }],
  ['avisos', { solicitacao_id: sol.id, protocolo: 1, para_papel: 'admin', tipo: 'x', texto: 'x' }],
  ['avaliacoes', { solicitacao_id: sol.id, desfecho: 'respondido', medico_nome: 'Fulano', registro_profissional: '1', registrado_por: eu.recepcao.id }],
  ['auditoria_dados', { acao: 'x', recurso: 'x' }],
];
for (const papel of ['callcenter', 'arquivo', 'recepcao', 'admin']) {
  let bloqueou = true;
  for (const [tabela, corpo] of alvos) {
    const x = await chamar(eu[papel], tabela, { metodo: 'POST', corpo });
    if (x.status < 400) bloqueou = false;
  }
  check(bloqueou, `${papel}: nenhum INSERT direto passa (${alvos.length} tabelas testadas)`);
}
r = await chamar(eu.admin, `solicitacoes?id=eq.${sol.id}`, { metodo: 'PATCH', corpo: { etapa: 'concluida' } });
check(recusou(r) && estado().etapa === 'aberta', 'nem o Administrador muda a etapa por UPDATE direto');
r = await chamar(eu.callcenter, `solicitacoes?id=eq.${sol.id}`, { metodo: 'DELETE' });
check(recusou(r) && estado() !== null, 'nem o Call Center apaga uma solicitação');
r = await chamar(eu.admin, 'config_clinica?id=eq.1', { metodo: 'PATCH', corpo: { exigir_arquivamento_para_concluir: true } });
check(recusou(r) && psql('select exigir_arquivamento_para_concluir from public.config_clinica') === 'f', 'a configuração só muda pela função, nem pelo Administrador direto');

// ================================================================ 7. avisos por equipe
console.log('\n## Avisos');
const avArquivo = await ler(eu.arquivo, 'avisos', 'select=id,para_papel');
check(avArquivo.json.length > 0 && avArquivo.json.every((a) => a.para_papel === 'arquivo'), 'cada equipe lê só os avisos dela');
const avCc = (await ler(eu.callcenter, 'avisos', 'select=para_papel')).json;
check(avCc.every((a) => a.para_papel === 'callcenter'), 'o Call Center não lê os do Arquivo');
const naoLidosCc = psql("select count(*) from public.avisos where para_papel='callcenter' and lido_em is null");
r = await rpc(eu.arquivo, 'marcar_avisos_lidos', {});
check(r.status === 200 && Number(r.json) > 0, 'o Arquivo marca os seus avisos como lidos');
check(psql("select count(*) from public.avisos where para_papel='callcenter' and lido_em is null") === naoLidosCc, 'e isso não toca nos avisos de outra equipe');

// ================================================================ 8. tarefas
console.log('\n## Tarefas');
const tarefaCc = psql(`select id from public.tarefas where solicitacao_id='${sol.id}' and estado='pendente' limit 1`);
r = await rpc(eu.arquivo, 'concluir_tarefa', { p_id: tarefaCc });
check(recusou(r, '42501') && /Call Center|Recepção/.test(msg(r)), 'ninguém dá por feita a tarefa de outro papel');

// ================================================================ 9. configuração
console.log('\n## Configuração da clínica');
r = await rpc(eu.recepcao, 'salvar_config', { p_exigir: true });
check(recusou(r, '42501'), 'só o Administrador salva a configuração');
r = await rpc(eu.admin, 'salvar_config', { p_metas: { com_medico: 0 } });
check(recusou(r, 'P0001') && /entre 1 e 720/.test(msg(r)), 'meta zero é recusada');
r = await rpc(eu.admin, 'salvar_config', { p_metas: { com_medico: 721 } });
check(recusou(r, 'P0001'), 'meta acima de 720 h também');
r = await rpc(eu.admin, 'salvar_config', { p_metas: { etapa_que_nao_existe: 3 } });
check(recusou(r, 'P0001') && /Etapa desconhecida/.test(msg(r)), 'etapa desconhecida é recusada');
r = await rpc(eu.admin, 'salvar_config', { p_medicos: [{ nome: 'Dr. A', registro: '1' }, { nome: 'dr. a', registro: '2' }] });
check(recusou(r, 'P0001') && /mesmo nome/.test(msg(r)), 'dois médicos com o mesmo nome são recusados');
r = await rpc(eu.admin, 'salvar_config', { p_medicos: [{ nome: 'Dra. B', registro: '' }] });
check(recusou(r, 'P0001') && /nome e registro/.test(msg(r)), 'médico sem registro é recusado');
r = await rpc(eu.admin, 'salvar_config', { p_mensagens: { modelo_inventado: 'oi' } });
check(recusou(r, 'P0001'), 'modelo de mensagem desconhecido é recusado');
r = await rpc(eu.admin, 'salvar_config', { p_metas: { com_medico: 3, aguardando_entrega: null }, p_medicos: [{ nome: 'Dr. Teste', registro: 'CRM 9', especialidade: 'Clínica' }] });
check(r.status === 200 && r.json.metas.com_medico === 3 && r.json.metas.aguardando_entrega === null && r.json.metas.aberta === 2 && r.json.medicos.length === 1, 'configuração válida salva, e o que não foi enviado fica como estava');

// ================================================================ 10. auditoria
console.log('\n## Auditoria dos dados');
const acoes = json(`select coalesce(json_agg(distinct acao), '[]') from public.auditoria_dados where id > ${marco}`);
check(['criacao', 'transicao', 'movimento', 'comunicacao', 'avaliacao', 'entrega', 'assumir', 'liberar', 'leitura', 'configuracao'].every((a) => acoes.includes(a)), 'cada tipo de ação deixou linha na auditoria');
check(psql(`select count(*) from public.auditoria_dados where id > ${marco} and ator_id is null`) === '0', 'toda linha sabe quem agiu (vem do token)');
check((await linhas(eu.admin, 'auditoria_dados', `id=gt.${marco}`)) > 20 && (await linhas(eu.callcenter, 'auditoria_dados')) === 0 && (await linhas(eu.recepcao, 'auditoria_dados')) === 0, 'só o Administrador lê a auditoria');
r = await chamar(eu.admin, `auditoria_dados?id=gt.${marco}`, { metodo: 'DELETE' });
check(recusou(r), 'nem o Administrador apaga a auditoria pela API');
check(/não pode ser alterada/.test(psqlBruto(`delete from public.auditoria_dados where id > ${marco}`).stderr), 'e o próprio banco recusa, até para o dono da tabela');

// ================================================================ limpeza
console.log('\n## Limpeza');
const lista = idPac.map((i) => `'${i}'`).join(',');
psql(`set session_replication_role = replica;
  delete from public.auditoria_dados where id > ${marco};
  do $$ begin if to_regclass('public.auditoria_contas') is not null then delete from public.auditoria_contas where alvo_id = '${cc2Conta.id}'; end if; end $$;`);
psql(`delete from public.solicitacoes where paciente_id in (${lista});
  delete from public.prontuarios where paciente_id in (${lista});
  delete from public.pacientes where id in (${lista});
  update public.config_clinica set metas = '${metasOriginais}'::jsonb, medicos = '${medicosOriginais}'::jsonb;`);
await fetch(`${URL_LOCAL}/auth/v1/admin/users/${cc2Conta.id}`, { method: 'DELETE', headers: { apikey: anonKey, authorization: `Bearer ${servicoKey}` } });
psql(`set session_replication_role = replica; do $$ begin if to_regclass('public.auditoria_contas') is not null then delete from public.auditoria_contas where alvo_id = '${cc2Conta.id}'; end if; end $$;`);
check(psql(`select count(*) from public.pacientes where id in (${lista})`) === '0' && psql(`select count(*) from public.auditoria_dados where id > ${marco}`) === '0', '(o que o teste criou foi removido)');

console.log('');
if (falhas.length) { console.log(`✗ ${falhas.length} falha(s)`); falhas.forEach((f) => console.log(' - ' + f)); process.exit(1); }
console.log('✓ dados do atendimento no banco: tudo passou');
process.exit(0);
