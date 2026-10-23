// A aplicação INTEIRA contra o banco de verdade: login real, telas renderizando com dados do
// Postgres, e o fluxo andando pelas mesmas funções que a interface usa (js/dados.js em modo banco).
//
// Complementa os outros dois testes: tests/telas.mjs exercita as telas sobre a camada em memória,
// e tests/banco.mjs exercita o banco sem tela. Este fecha o elo — a tela falando com o banco.
//
// Pré-requisito:  cd supabase/local && docker compose up -d && cd ../.. && node supabase/local/preparar.mjs
// Rodar:          npm run test:app
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { anonKey, URL_LOCAL, SENHA_LOCAL } from '../supabase/local/contas.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const falhas = [], erros = [];
const check = (c, m) => { if (!c) { falhas.push(m); console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const origErr = console.error;
console.error = (...a) => { erros.push(a.map(String).join(' ')); origErr('  [console.error]', ...a.map((x) => (x?.message ? x.message : String(x)).slice(0, 200))); };
process.on('unhandledRejection', (e) => { erros.push('unhandled: ' + (e?.stack || e)); origErr('UNHANDLED', e?.stack || e); });

try { await fetch(URL_LOCAL + '/auth/v1/health'); } catch {
  console.log('✗ A stack local não está no ar. Rode: cd supabase/local && docker compose up -d && cd ../.. && node supabase/local/preparar.mjs');
  process.exit(1);
}

// ---------------------------------------------------------------- ambiente
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/Could not parse CSS|Not implemented/.test(e.message)) erros.push('jsdom: ' + e.message); });
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost:3005/', virtualConsole: vc, pretendToBeVisual: true });
for (const k of ['window', 'document', 'navigator', 'location', 'Element', 'Node', 'HTMLElement', 'Event', 'CustomEvent', 'getComputedStyle', 'URLSearchParams', 'Blob']) {
  if (!(k in globalThis) || ['location', 'document', 'window', 'navigator'].includes(k)) Object.defineProperty(globalThis, k, { value: dom.window[k], writable: true, configurable: true });
}
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.localStorage = dom.window.localStorage;
dom.window.URL.createObjectURL = () => 'blob:fake';
dom.window.URL.revokeObjectURL = () => {};

const mod = (f) => import(pathToFileURL(path.join(REPO, 'js', f)).href);
const A = await mod('auth.js');
const D = await mod('dados.js');          // a fachada, em modo banco (nada chama usarMemoria)
A.configurar({ url: URL_LOCAL, anonKey });
A.aoNavegar(() => {});
const psql = (sql) => spawnSync('docker', ['exec', 'prontus-auth-db-1', 'psql', '-U', 'postgres', '-d', 'prontus', '-t', '-A', '-c', sql], { encoding: 'utf8' }).stdout.trim();

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const body = () => dom.window.document.getElementById('app').textContent;
const EMAILS = { callcenter: 'callcenter@prontus.local', arquivo: 'arquivo@prontus.local', recepcao: 'recepcao@prontus.local', admin: 'admin@prontus.local' };
async function entrarComo(papel) {
  dom.window.sessionStorage.clear();
  const r = await A.entrar(EMAILS[papel], SENHA_LOCAL);
  if (!r.perfil) throw new Error(`não entrou como ${papel}: ${r.erro}`);
  await D.prepararDados();                 // cada página faz isto ao abrir; aqui, a cada troca de papel
}
const abrirTela = async (arquivo, fn = 'init', query = '') => {
  dom.window.document.getElementById('app').replaceChildren();
  dom.window.history.replaceState({}, '', '/' + query);
  const m = await import(pathToFileURL(path.join(REPO, 'js/modules', arquivo)).href + '?t=' + Math.random());
  await m[fn]();
  await wait(120);
};

const marcoProtocolo = Number(psql('select coalesce(max(protocolo), 1000) from public.solicitacoes'));
const marcoAuditoria = Number(psql('select coalesce(max(id), 0) from public.auditoria_dados'));

// ================================================================ 1. cada tela, cada papel
console.log('\n## Cada tela abre para cada papel, com dados do banco');
const TELAS = ['painel.js', 'filas.js', 'minhafila.js', 'solicitacoes.js', 'prontuarios.js', 'registros.js', 'relatorios.js', 'permissoes.js', 'usuarios.js', 'configuracoes.js'];
for (const papel of Object.keys(EMAILS)) {
  await entrarComo(papel);
  let ok = true;
  for (const t of TELAS) {
    await abrirTela(t);
    const txt = body();
    if (txt.length < 100 || /Não foi possível carregar esta página/.test(txt)) { ok = false; console.log(`    falhou: ${papel} · ${t}`); }
  }
  check(ok, `${papel}: as ${TELAS.length} telas renderizam sem erro`);
}
check(!/Demonstração — dados fictícios/.test(body()), 'e não aparece a faixa "Demonstração": os dados são de verdade');

// ================================================================ 2. o Call Center abre um pedido
console.log('\n## O Call Center abre um pedido pela camada de dados');
await entrarComo('callcenter');
const { data: pacientes } = await D.listar('pacientes');
check(pacientes.length >= 6, `o Call Center lê os pacientes (${pacientes.length})`);
const dup0 = D.possivelDuplicidade({ tipo: 'pedido_receita', paciente_id: pacientes[0].id });
check(Array.isArray(dup0), 'a checagem de duplicidade funciona sobre as solicitações listadas');
let r = await D.abrirSolicitacao({ tipo: 'pedido_receita', paciente_id: pacientes[0].id, relato: 'Pede renovação da receita de uso contínuo.', prioridade: 'alta' });
const sol = r.data;
check(!r.error && sol?.protocolo > marcoProtocolo && sol.etapa === 'aberta', `pedido aberto (protocolo ${sol?.protocolo})`);
r = await D.moverSolicitacao({ id: sol.id, transicao: 'T03' });
check(r.error?.code === 'P0001' && /Registre o aviso/.test(r.error.message), 'avançar sem registrar o aviso é recusado, com a frase pronta para a tela');

await abrirTela('solicitacao.js', 'initFicha', `solicitacoes/detalhe.html?id=${sol.id}`);
check(body().includes('Próxima ação') && body().includes('Pede renovação da receita'), 'o detalhe abre, com a próxima ação e o relato (lido pela função auditada)');
await abrirTela('solicitacoes.js');
check(body().includes('#' + sol.protocolo) && body().includes(pacientes[0].nome), 'a lista mostra o caso novo, com o nome do paciente');

// ================================================================ 3. o caso andando, papel por papel
console.log('\n## O caso anda pelas telas e pelo banco');
await D.registrarComunicacao({ solicitacao_id: sol.id, canal: 'whatsapp_grupo', tipo: 'pedido_prontuario', destinatario: 'Grupo operacional', resultado: 'registrada', texto: `Protocolo ${sol.protocolo}` });
r = await D.moverSolicitacao({ id: sol.id, transicao: 'T03' });
check(!r.error && r.data.etapa === 'aguardando_prontuario', 'T03: pedido de prontuário avança');

await entrarComo('arquivo');
await abrirTela('filas.js');
check(body().includes('#' + sol.protocolo), 'o caso aparece na fila do Arquivo');
await abrirTela('solicitacoes.js');
check(!body().includes(pacientes[0].nome) && body().includes('reduzido'), 'a lista do Arquivo não mostra o nome do paciente');
await abrirTela('solicitacao.js', 'initFicha', `solicitacoes/detalhe.html?id=${sol.id}`);
check(body().includes('O seu papel não lê o relato do paciente') && !body().includes('Pede renovação da receita'), 'o detalhe do Arquivo não mostra o relato');
r = await D.lerRelato(sol.id, ['arquivo']);
check(r.error?.code === '42501', 'e o banco recusa a leitura, não só a tela');
const { data: pacsArq } = await D.listar('pacientes');
check(pacsArq.length === 0, 'o Arquivo recebe zero pacientes do banco');
const prontuario = D.prontuarioPor(sol.prontuario_id);
check(Boolean(prontuario), 'mas enxerga o prontuário e onde ele está');
for (const mov of ['localizado', 'retirado']) await D.moverProntuario({ prontuario_id: prontuario.id, mov, solicitacao_id: sol.id });
r = await D.moverSolicitacao({ id: sol.id, transicao: 'T04' });
check(!r.error && r.data.etapa === 'prontuario_em_transito' && D.prontuarioPor(prontuario.id).local === 'em_transito_para_recepcao', 'T04: etapa e pasta andam juntas, e a cópia local já reflete');

await entrarComo('recepcao');
r = await D.moverSolicitacao({ id: sol.id, transicao: 'T05' });
await D.moverProntuario({ prontuario_id: prontuario.id, mov: 'conferido', solicitacao_id: sol.id });
r = await D.moverSolicitacao({ id: sol.id, transicao: 'T06', medico_nome: 'Dr. Paulo Aragão', medico_registro: 'CRM 1' });
check(!r.error && r.data.etapa === 'com_medico', 'a Recepção leva o caso ao médico');
r = await D.registrarAvaliacao({ solicitacao_id: sol.id, desfecho: 'receita_emitida', conteudo_clinico: 'isto NÃO pode ser gravado', resumo_para_paciente: 'nem isto' });
check(!r.error && !JSON.stringify(r.data).includes('NÃO pode'), 'o retorno é registrado, e o texto clínico enviado por engano nem chega ao banco');
await D.moverSolicitacao({ id: sol.id, transicao: 'T07' });
await abrirTela('solicitacao.js', 'initFicha', `solicitacoes/detalhe.html?id=${sol.id}`);
check(/Retorno do médico/.test(body()) && /Receita emitida/.test(body()) && /sem texto clínico guardado/.test(body()), 'o detalhe mostra o retorno, sem texto clínico');
check(/Pede renovação da receita/.test(body()), 'a Recepção lê o relato');
await D.registrarComunicacao({ solicitacao_id: sol.id, canal: 'whatsapp_grupo', tipo: 'aviso_receita', destinatario: 'Grupo operacional', resultado: 'registrada', texto: 'receita pronta' });
await D.moverSolicitacao({ id: sol.id, transicao: 'T10' });

await entrarComo('callcenter');
await abrirTela('minhafila.js');
await D.moverSolicitacao({ id: sol.id, transicao: 'T12' });
await D.registrarComunicacao({ solicitacao_id: sol.id, canal: 'telefone', tipo: 'contato_paciente', destinatario: 'Paciente', resultado: 'falou', texto: 'Paciente informado.' });
await D.registrarEntrega({ solicitacao_id: sol.id, modo: 'fisica', estado: 'orientada' });
await entrarComo('recepcao');
await D.registrarEntrega({ solicitacao_id: sol.id, modo: 'fisica', estado: 'retirada_confirmada' });
await entrarComo('callcenter');
r = await D.moverSolicitacao({ id: sol.id, transicao: 'T13' });
check(!r.error && r.data.etapa === 'concluida' && r.data.desfecho === 'resolvida', 'o Call Center conclui o caso');
const dos = await D.dossie(sol.id);
check(!dos.error && dos.data.eventos.length >= 9 && dos.data.entrega?.historico?.length === 2 && dos.data.documentos.length === 1, 'o dossiê reúne a linha do tempo, a entrega com histórico e o documento');
check(!('relato' in dos.data.sol), 'e o relato não vem junto');

// ================================================================ 4. avisos e prazos
console.log('\n## Avisos');
await entrarComo('arquivo');
const avisos = D.avisosDoPapel('arquivo');
check(avisos.some((a) => a.protocolo === sol.protocolo), 'o Arquivo recebeu o aviso de que o caso chegou');
const lidos = await D.marcarAvisosLidos({ papel: 'arquivo' });
check(!lidos.error && D.avisosDoPapel('arquivo', { somenteNaoLidos: true }).length === 0, 'marcar como lidos zera o sininho');
const novos = await D.escalonarAtrasos();
check(Number.isInteger(novos), 'a varredura de prazos roda no banco');

// ================================================================ 5. o administrador
console.log('\n## Administrador');
await entrarComo('admin');
await abrirTela('painel.js');
check(/Visão geral/.test(body()) && /Quem tem acesso/.test(body()), 'o painel do Administrador abre');
const { data: auditoria } = await D.listar('auditoria');
check(auditoria.some((a) => a.acao === 'transicao') && auditoria.some((a) => a.acao === 'leitura' && a.recurso === 'relato'), 'a auditoria traz as transições e as leituras do relato');
await abrirTela('permissoes.js');
check(/Auditoria de acesso/.test(body()), 'a tela de auditoria abre');
const cfg = D.configAtual();
check(cfg.metas.com_medico > 0 && Array.isArray(cfg.medicos), 'a configuração da clínica vem do banco');
r = await D.salvarConfig({ metas: { com_medico: 0 } });
check(r.error?.code === 'P0001' && /entre 1 e 720/.test(r.error.message), 'meta inválida é recusada pelo banco');
await entrarComo('callcenter');
r = await D.salvarConfig({ exigirArquivamentoParaConcluir: true });
check(r.error?.code === '42501', 'quem não é administrador não salva a configuração');
r = await D.reiniciar();
check(Boolean(r.error), 'não existe "reiniciar" sobre dados reais');

// ================================================================ limpeza
console.log('\n## Limpeza');
psql(`set session_replication_role = replica; delete from public.auditoria_dados where id > ${marcoAuditoria};`);
psql(`delete from public.solicitacoes where protocolo > ${marcoProtocolo};
  update public.prontuarios set local = 'arquivo', custodia_usuario_id = null, solicitacao_id = null where codigo like 'PR-20%';`);
check(psql(`select count(*) from public.solicitacoes where protocolo > ${marcoProtocolo}`) === '0', '(o que o teste criou foi removido)');

console.log('');
if (erros.length) console.log(`console.error inesperado: ${erros.length}`);
if (falhas.length || erros.length) { console.log(`✗ ${falhas.length} falha(s); console.error: ${erros.length}`); falhas.forEach((f) => console.log(' - ' + f)); dom.window.close(); process.exit(1); }
console.log('✓ a aplicação contra o banco de verdade: tudo passou');
dom.window.close();
process.exit(0);
