// Teste de fumaça do Prontus: renderiza cada tela com cada papel e exercita os dois fluxos de
// ponta a ponta, verificando as regras obrigatórias do processo.
// Roda em jsdom, sobre a camada de dados em memória (js/dados.js) — nenhuma rede, nenhum banco.
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const falhas = [], erros = [];
const check = (c, m) => { if (!c) { falhas.push(m); console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const origErr = console.error;
console.error = (...a) => { erros.push(a.map(String).join(' ')); origErr('  [console.error]', ...a.map((x) => (x?.message ? x.message : String(x)).slice(0, 200))); };
process.on('unhandledRejection', (e) => { erros.push('unhandled: ' + (e?.stack || e)); origErr('UNHANDLED', e?.stack || e); });

// ---------------------------------------------------------------- ambiente
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/Could not parse CSS|Not implemented/.test(e.message)) erros.push('jsdom: ' + e.message); });
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://exemplo.test/', virtualConsole: vc, pretendToBeVisual: true });
for (const k of ['window', 'document', 'navigator', 'location', 'Element', 'Node', 'HTMLElement', 'Event', 'CustomEvent', 'getComputedStyle', 'URLSearchParams', 'Blob', 'URL']) {
  if (!(k in globalThis) || k === 'location' || k === 'document' || k === 'window' || k === 'navigator') {
    Object.defineProperty(globalThis, k, { value: dom.window[k], writable: true, configurable: true });
  }
}
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.localStorage = dom.window.localStorage;
dom.window.URL.createObjectURL = () => 'blob:fake';
dom.window.URL.revokeObjectURL = () => {};

const mod = (f) => import(pathToFileURL(path.join(REPO, 'js', f)).href);
const F = await mod('fluxo.js');
const P = await mod('permissoes.js');
const D = await mod('dados.js');
const Auth = await mod('auth.js');

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const body = () => dom.window.document.getElementById('app').textContent;
// Entra como a pessoa do papel, sem rede: grava a sessão que o login gravaria. Os ids são os da
// equipe semeada em js/dados.js, para os casos já "assumidos" por eles continuarem valendo.
const DO_PAPEL = { callcenter: 'u-cc1', arquivo: 'u-ar1', recepcao: 'u-re1', admin: 'u-ad1' };
const trocarPapel = (p) => {
  const u = D.usuarioPor(DO_PAPEL[p]);
  Auth.guardarSessao({ access_token: 't', refresh_token: 'r', expires_at: 9e9, perfil: { id: u.id, nome: u.nome, cargo: u.cargo, papel: p, email: u.email } });
};
const abrirTela = async (arquivo, fn = 'init', query = '') => {
  dom.window.document.getElementById('app').replaceChildren();
  dom.window.history.replaceState({}, '', '/' + query);
  const m = await import(pathToFileURL(path.join(REPO, 'js/modules', arquivo)).href + '?t=' + Math.random());
  await m[fn]();
  await wait(60);
};

// ================================================================ 1. telas por papel
console.log('\n## Telas renderizam para cada papel');
const TELAS = [['painel.js', 'init'], ['filas.js', 'init'], ['minhafila.js', 'init'], ['solicitacoes.js', 'init'], ['prontuarios.js', 'init'], ['registros.js', 'init'], ['relatorios.js', 'init'], ['permissoes.js', 'init'], ['usuarios.js', 'init'], ['configuracoes.js', 'init']];
for (const papel of Object.keys(P.PAPEIS)) {
  trocarPapel(papel);
  for (const [arq, fn] of TELAS) {
    await abrirTela(arq, fn);
    const t = body();
    check(t.length > 100, `${P.PAPEIS[papel]} · ${arq.replace('.js', '')} renderizou (${t.length} caracteres)`);
  }
}

// ================================================================ 2. seed consistente
console.log('\n## Dados de exemplo');
const { data: sols } = await D.listar('solicitacoes');
check(sols.length >= 15, `${sols.length} solicitações semeadas`);
const etapasUsadas = new Set(sols.map((s) => s.etapa));
check(etapasUsadas.size >= 7, `cobrem ${etapasUsadas.size} etapas diferentes`);
check(sols.some((s) => s.tipo === 'duvida_correcao') && sols.some((s) => s.tipo === 'pedido_receita'), 'os dois fluxos estão representados');
const { data: pronts } = await D.listar('prontuarios');
check(pronts.some((p) => p.local !== 'arquivo'), 'há prontuário fora do arquivo (pendência paralela visível)');
const { data: docs } = await D.listar('documentos');
check(docs.some((d) => d.versao === 2 && d.substitui_id), 'há receita corrigida em 2ª versão, com a 1ª preservada');
check(docs.filter((d) => d.estado === 'substituido').length >= 1, 'a versão anterior ficou marcada como substituída');

// ================================================================ 2b. interface
//
// jsdom não calcula layout, então nenhum teste aqui vê uma etiqueta vazando de um painel. O que
// ELE vê é a CAUSA: a linha de caso é uma grade de três colunas, e ela foi parar na coluna lateral
// de 340 px, onde o texto quebrava uma palavra por linha. A regra que isso vira é estrutural —
// lista de caso mora na coluna larga — e é essa que o teste segura.
console.log('\n## Interface: onde a linha de caso mora, e como ela abre');
const doc = dom.window.document;
const clicar = (el) => el.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

trocarPapel('recepcao');
await abrirTela('painel.js');
const colunaLarga = doc.querySelector('.det > .main');
const colunaEstreita = doc.querySelector('.det > .aside');
check(Boolean(colunaLarga?.querySelector('.item')), 'a tela inicial da equipe põe os casos na coluna larga');
check(!colunaEstreita?.querySelector('.item'), 'e nenhum caso na coluna estreita, onde a linha de três colunas espremia');

const inv = colunaLarga.querySelector('.itemwrap');
check(Boolean(inv), 'cada caso vem num invólucro que abre');
const gatilho = inv.querySelector('.chev');
const detalhe = inv.querySelector('.peek');
check(Boolean(gatilho) && Boolean(detalhe), 'com gatilho e painel de detalhe');
check(detalhe.hidden && gatilho.getAttribute('aria-expanded') === 'false', 'nasce fechado, e o aria-expanded diz isso');
clicar(gatilho);
check(!detalhe.hidden && gatilho.getAttribute('aria-expanded') === 'true', 'o clique abre e atualiza o aria-expanded');
check(detalhe.textContent.trim().length > 20, 'o detalhe só é montado na primeira abertura, e vem com conteúdo');
clicar(gatilho);
check(detalhe.hidden, 'o segundo clique fecha');

await abrirTela('filas.js');
const filtro = doc.querySelector('.qfind input');
check(Boolean(filtro), 'a fila tem filtro rápido');
check(Boolean(doc.querySelector('.itemwrap .chev')), 'e as linhas da fila também abrem no lugar');
const antesDoFiltro = doc.querySelectorAll('.qlista .itemwrap').length;
filtro.value = 'zzqqxx-nada-casa';
filtro.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
check(antesDoFiltro > 0 && doc.querySelectorAll('.qlista .itemwrap').length === 0, 'filtrar por algo inexistente esvazia a lista');
check(doc.querySelector('.qfind input') === filtro, 'o campo do filtro é o MESMO nó depois de redesenhar a lista — é isso que não deixa o foco escapar a cada tecla');
trocarPapel('callcenter');

// ================================================================ 3. permissões (RN-05, RN-11, RN-18)
console.log('\n## Permissões: cada papel só faz o que é dele');
check(Object.keys(P.PAPEIS).join(',') === 'callcenter,arquivo,recepcao,admin', 'são quatro papéis, e o médico não é um deles');
const alvo = sols.find((s) => s.etapa === 'com_medico');
check(Boolean(alvo), 'existe um caso com o médico para testar');
check(Boolean(alvo.medico_nome) && Boolean(alvo.medico_registro), 'o caso guarda a quem foi levado, por nome e registro');
let r = await D.registrarAvaliacao({ solicitacao_id: alvo.id, desfecho: 'respondido', conteudo_clinico: 'x', papeis: ['callcenter'], ator: 'u-cc1' });
check(r.error?.code === '42501', 'Call Center NÃO registra o retorno do médico (RN-11)');
r = await D.registrarAvaliacao({ solicitacao_id: alvo.id, desfecho: 'respondido', conteudo_clinico: 'x', papeis: ['admin'], ator: 'u-ad1' });
check(r.error?.code === '42501', 'Administrador NÃO registra o retorno do médico (RN-11)');
r = await D.registrarAvaliacao({ solicitacao_id: alvo.id, desfecho: 'respondido', conteudo_clinico: 'x', papeis: ['recepcao'], ator: 'u-re1' });
check(!r.error, 'Recepção registra o retorno, herdando o médico já gravado no caso');
check(r.data.medico_nome === alvo.medico_nome && r.data.registrado_por === 'u-re1', 'o registro sai assinado: quem decidiu e quem transcreveu');
check(!P.pode(['callcenter'], 'avaliacao_conteudo'), 'Call Center não lê conteúdo clínico (RN-18)');
check(!P.pode(['admin'], 'avaliacao_conteudo'), 'Administrador não lê conteúdo clínico por administrar');
check(!P.pode(['admin'], 'tarefa_ver'), 'Administrador não tem fila: acompanha em vez de executar');
check(P.pode(['admin'], 'usuarios', 'editar') && P.pode(['admin'], 'configuracoes', 'editar') && P.pode(['admin'], 'auditoria'), 'Administrador cria usuários, configura a clínica e vê a auditoria');
check(P.pode(['recepcao'], 'avaliacao_conteudo'), 'Recepção lê o conteúdo clínico que ela mesma registra');
check(!P.pode(['arquivo'], 'documento_abrir'), 'arquivo não abre documento clínico');

// ---------------------------------------------------------------- usuários (o super usuário)
console.log('\n## Usuários: o Administrador cria, edita, desativa e exclui');
r = await D.criarUsuario({ nome: 'Teste da Silva', email: 't@exemplo.test', papel: 'arquivo', papeis: ['callcenter'], ator: 'u-cc1' });
check(r.error?.code === '42501', 'só o Administrador cria usuário');
r = await D.criarUsuario({ nome: 'Teste da Silva', email: 't@exemplo.test', papel: 'arquivo', papeis: ['admin'], ator: 'u-ad1' });
check(!r.error && r.data.papeis[0] === 'arquivo', 'Administrador cria usuário com um papel');
const novoU = r.data;
r = await D.criarUsuario({ nome: 'Outro', email: 'T@EXEMPLO.TEST', papel: 'arquivo', papeis: ['admin'], ator: 'u-ad1' });
check(Boolean(r.error), 'e-mail repetido é recusado');
r = await D.excluirUsuario({ id: novoU.id, papeis: ['admin'], ator: 'u-ad1' });
check(!r.error && r.data.removido, 'quem nunca agiu é excluído de verdade');
r = await D.excluirUsuario({ id: 'u-re1', papeis: ['admin'], ator: 'u-ad1' });
check(!r.error && r.data.desativado && r.data.rastro > 0, 'quem tem histórico é DESATIVADO, não apagado: a autoria não se perde');
r = await D.atualizarUsuario({ id: 'u-re1', ativo: true, papeis: ['admin'], ator: 'u-ad1' });
check(!r.error && r.data.ativo, 'e pode ser reativado');
r = await D.excluirUsuario({ id: 'u-ad1', papeis: ['admin'], ator: 'u-ad1' });
check(Boolean(r.error), 'ninguém exclui a própria conta');
r = await D.atualizarUsuario({ id: 'u-ad1', papel: 'callcenter', papeis: ['admin'], ator: 'u-ad1' });
check(Boolean(r.error) && /administrador/i.test(r.error.message), 'o último administrador não pode se rebaixar: a clínica ficaria sem administração');

// ================================================================ 4. custódia do prontuário
console.log('\n## Prontuário: custódia e confirmação de recebimento');
const emTransito = sols.find((s) => s.etapa === 'prontuario_em_transito');
if (emTransito) {
  r = await D.moverProntuario({ prontuario_id: emTransito.prontuario_id, mov: 'recebido', papeis: ['arquivo'], ator: 'u-ar1', solicitacao_id: emTransito.id });
  check(r.error?.code === '42501', 'o Arquivo NÃO confirma o próprio recebimento (RN-09)');
  r = await D.moverProntuario({ prontuario_id: emTransito.prontuario_id, mov: 'recebido', papeis: ['recepcao'], ator: 'u-re1', solicitacao_id: emTransito.id });
  check(!r.error, 'a Recepção confirma o recebimento');
  const antes = (await D.listar('movimentos', { prontuario_id: emTransito.prontuario_id })).data.length;
  await D.moverProntuario({ prontuario_id: emTransito.prontuario_id, mov: 'recebido', papeis: ['recepcao'], ator: 'u-re1', solicitacao_id: emTransito.id });
  const depois = (await D.listar('movimentos', { prontuario_id: emTransito.prontuario_id })).data.length;
  check(antes === depois, 'repetir a mesma movimentação não duplica o registro (RN-17)');
}
const aguardando = sols.find((s) => s.etapa === 'aguardando_prontuario');
if (aguardando) {
  r = await D.moverProntuario({ prontuario_id: aguardando.prontuario_id, mov: 'entregue', papeis: ['arquivo'], ator: 'u-ar1', solicitacao_id: aguardando.id });
  check(Boolean(r.error), 'não dá para entregar o prontuário sem registrar localizar e retirar antes');
}

// ================================================================ 5. conclusão (RN-06, RN-13)
console.log('\n## Conclusão: requisitos obrigatórios');
const comContato = sols.find((s) => s.etapa === 'aguardando_contato_paciente' && s.tipo === 'duvida_correcao');
check(Boolean(comContato), 'o seed tem um Fluxo 1 aguardando contato com o paciente');
r = await D.moverSolicitacao({ id: comContato.id, transicao: 'T11', papeis: ['callcenter'], ator: 'u-cc1' });
check(Boolean(r.error) && /contato/i.test(r.error.message), 'NÃO conclui sem contato efetivo com o paciente (RN-06)');
await D.registrarComunicacao({ solicitacao_id: comContato.id, canal: 'telefone', tipo: 'contato_paciente', resultado: 'nao_atendeu', papeis: ['callcenter'], ator: 'u-cc1' });
r = await D.moverSolicitacao({ id: comContato.id, transicao: 'T11', papeis: ['callcenter'], ator: 'u-cc1' });
check(Boolean(r.error), 'tentativa frustrada (não atendeu) também não conclui');
await D.registrarComunicacao({ solicitacao_id: comContato.id, canal: 'telefone', tipo: 'contato_paciente', resultado: 'falou', papeis: ['callcenter'], ator: 'u-cc1' });
r = await D.moverSolicitacao({ id: comContato.id, transicao: 'T11', papeis: ['callcenter'], ator: 'u-cc1' });
check(!r.error && r.data.etapa === 'concluida', 'com contato efetivo, o Fluxo 1 conclui');
const tentado = sols.find((s) => { const e = D.db.entregas.find((x) => x.solicitacao_id === s.id); return e?.estado === 'envio_tentado'; });
if (tentado) {
  r = await D.moverSolicitacao({ id: tentado.id, transicao: 'T13', papeis: ['callcenter'], ator: 'u-cc1' });
  check(Boolean(r.error) && /tentad|confirma/i.test(r.error.message), 'NÃO conclui com envio apenas tentado: tentativa não é entrega (RN-13)');
  r = await D.registrarEntrega({ solicitacao_id: tentado.id, modo: 'digital', estado: 'retirada_confirmada', papeis: ['recepcao'], ator: 'u-re1' });
  check(Boolean(r.error), 'retirada confirmada não existe em entrega digital (RN-14)');
  r = await D.registrarEntrega({ solicitacao_id: tentado.id, modo: 'digital', estado: 'enviado', nota: 'confirmado', papeis: ['callcenter'], ator: 'u-cc1' });
  check(!r.error, 'registrar a confirmação do envio funciona');
  r = await D.moverSolicitacao({ id: tentado.id, transicao: 'T13', papeis: ['callcenter'], ator: 'u-cc1' });
  check(!r.error, 'com a entrega confirmada, conclui');
}

// ================================================================ 6. fluxo completo do zero
console.log('\n## Fluxo 2 de ponta a ponta, do registro à entrega');
await D.reiniciar();
const { data: pacs } = await D.listar('pacientes');
r = await D.abrirSolicitacao({ tipo: 'pedido_receita', paciente_id: pacs[0].id, relato: 'Teste ponta a ponta', papeis: ['callcenter'], ator: 'u-cc1' });
check(!r.error && r.data.protocolo > 0, 'Call Center abre a solicitação e recebe protocolo');
const nova = r.data;
check(D.possivelDuplicidade({ tipo: 'pedido_receita', paciente_id: pacs[0].id }).length === 1, 'duplicidade provável é detectada (e só avisa)');
r = await D.abrirSolicitacao({ tipo: 'pedido_receita', paciente_id: pacs[0].id, relato: 'Outro pedido legítimo', papeis: ['callcenter'], ator: 'u-cc1' });
check(!r.error, 'mesmo assim, uma segunda solicitação legítima do mesmo paciente é aceita (RF-04)');

const passo = async (desc, p) => { const x = await p; check(!x.error, desc + (x.error ? ' — ' + x.error.message : '')); return x; };
await passo('arquivo é avisado e a etapa vira aguardando prontuário', (async () => {
  await D.registrarComunicacao({ solicitacao_id: nova.id, canal: 'whatsapp_grupo', tipo: 'pedido_prontuario', resultado: 'registrada', texto: 'localizar', papeis: ['callcenter'], ator: 'u-cc1' });
  return D.moverSolicitacao({ id: nova.id, transicao: 'T03', papeis: ['callcenter'], ator: 'u-cc1' });
})());
await passo('arquivo localiza', D.moverProntuario({ prontuario_id: nova.prontuario_id, mov: 'localizado', papeis: ['arquivo'], ator: 'u-ar1', solicitacao_id: nova.id }));
await passo('arquivo retira', D.moverProntuario({ prontuario_id: nova.prontuario_id, mov: 'retirado', papeis: ['arquivo'], ator: 'u-ar1', solicitacao_id: nova.id }));
await passo('arquivo entrega', D.moverProntuario({ prontuario_id: nova.prontuario_id, mov: 'entregue', papeis: ['arquivo'], ator: 'u-ar1', solicitacao_id: nova.id }));
await passo('solicitação vai para em trânsito', D.moverSolicitacao({ id: nova.id, transicao: 'T04', papeis: ['arquivo'], ator: 'u-ar1' }));
const st1 = (await D.obter('solicitacoes', nova.id)).data;
check(st1.etapa === 'prontuario_em_transito', 'entrega iniciada NÃO conta como concluída (RN-21)');
await passo('recepção confirma o recebimento', D.moverProntuario({ prontuario_id: nova.prontuario_id, mov: 'recebido', papeis: ['recepcao'], ator: 'u-re1', solicitacao_id: nova.id }));
await passo('etapa vira prontuário na recepção', D.moverSolicitacao({ id: nova.id, transicao: 'T05', papeis: ['recepcao'], ator: 'u-re1' }));
r = await D.moverSolicitacao({ id: nova.id, transicao: 'T06', papeis: ['recepcao'], ator: 'u-re1', medico_nome: 'Dra. Helena Fontes' });
check(Boolean(r.error), 'não leva ao médico sem registrar a conferência');
await passo('recepção confere', D.moverProntuario({ prontuario_id: nova.prontuario_id, mov: 'conferido', papeis: ['recepcao'], ator: 'u-re1', solicitacao_id: nova.id }));
r = await D.moverSolicitacao({ id: nova.id, transicao: 'T06', papeis: ['recepcao'], ator: 'u-re1' });
check(Boolean(r.error) && /médico/i.test(r.error.message), 'não leva ao médico sem dizer a qual médico');
await passo('recepção leva ao médico', D.moverSolicitacao({ id: nova.id, transicao: 'T06', papeis: ['recepcao'], ator: 'u-re1', medico_nome: 'Dra. Helena Fontes' }));
const comMed = (await D.obter('solicitacoes', nova.id)).data;
check(comMed.etapa === 'com_medico' && comMed.medico_registro.startsWith('CRM'), 'o registro profissional veio da lista de médicos da clínica');
r = await D.registrarAvaliacao({ solicitacao_id: nova.id, desfecho: 'receita_emitida', conteudo_clinico: 'conteúdo fictício', resumo_para_paciente: 'resumo', papeis: ['callcenter'], ator: 'u-cc1' });
check(r.error?.code === '42501', 'o Call Center não transcreve o retorno nem no fluxo novo');
await passo('recepção registra o retorno do médico', D.registrarAvaliacao({ solicitacao_id: nova.id, desfecho: 'receita_emitida', conteudo_clinico: 'conteúdo fictício', resumo_para_paciente: 'resumo', papeis: ['recepcao'], ator: 'u-re1' }));
await passo('etapa vira retorno disponível', D.moverSolicitacao({ id: nova.id, transicao: 'T07', papeis: ['recepcao'], ator: 'u-re1' }));
const dossie1 = (await D.dossie(nova.id)).data;
check(dossie1.documentos.length === 1 && dossie1.documentos[0].estado === 'emitido', 'documento foi criado e está emitido');
await passo('recepção avisa no grupo', (async () => {
  await D.registrarComunicacao({ solicitacao_id: nova.id, canal: 'whatsapp_grupo', tipo: 'aviso_receita', resultado: 'registrada', texto: `protocolo ${nova.protocolo}`, papeis: ['recepcao'], ator: 'u-re1' });
  return D.moverSolicitacao({ id: nova.id, transicao: 'T10', papeis: ['recepcao'], ator: 'u-re1' });
})());
r = await D.registrarComunicacao({ solicitacao_id: nova.id, canal: 'telefone', tipo: 'contato_paciente', resultado: 'registrada', papeis: ['callcenter'], ator: 'u-cc1' });
check(Boolean(r.error), 'contato com o paciente sem resultado é recusado (RN-12)');
await passo('call center avisa o paciente', D.registrarComunicacao({ solicitacao_id: nova.id, canal: 'telefone', tipo: 'contato_paciente', resultado: 'falou', papeis: ['callcenter'], ator: 'u-cc1' }));
await passo('entrega física é orientada', D.registrarEntrega({ solicitacao_id: nova.id, modo: 'fisica', estado: 'orientada', papeis: ['callcenter'], ator: 'u-cc1' }));
await passo('etapa vira aguardando entrega', D.moverSolicitacao({ id: nova.id, transicao: 'T12', papeis: ['callcenter'], ator: 'u-cc1' }));
r = await D.moverSolicitacao({ id: nova.id, transicao: 'T13', papeis: ['callcenter'], ator: 'u-cc1' });
check(Boolean(r.error), 'não conclui com a retirada apenas orientada');
r = await D.registrarEntrega({ solicitacao_id: nova.id, modo: 'fisica', estado: 'retirada_confirmada', papeis: ['callcenter'], ator: 'u-cc1' });
check(r.error?.code === '42501', 'a confirmação da retirada física é da Recepção');
await passo('recepção confirma a retirada', D.registrarEntrega({ solicitacao_id: nova.id, modo: 'fisica', estado: 'retirada_confirmada', papeis: ['recepcao'], ator: 'u-re1' }));
await passo('agora conclui', D.moverSolicitacao({ id: nova.id, transicao: 'T13', papeis: ['callcenter'], ator: 'u-cc1' }));
const fim = (await D.obter('solicitacoes', nova.id)).data;
check(fim.etapa === 'concluida' && fim.desfecho === 'resolvida', 'caso concluído com desfecho resolvida');

// ---------------------------------------------------------------- trilha paralela depois de concluir
console.log('\n## Trilha paralela: devolução funciona com o caso JÁ concluído (RF-17)');
const pr = (await D.obter('prontuarios', nova.prontuario_id)).data;
check(pr.local !== 'arquivo', 'o prontuário ainda está fora do arquivo com o caso concluído');
await D.moverProntuario({ prontuario_id: nova.prontuario_id, mov: 'devolvido_medico', papeis: ['recepcao'], ator: 'u-re1', solicitacao_id: nova.id });
await passo('recepção devolve ao arquivo', D.moverProntuario({ prontuario_id: nova.prontuario_id, mov: 'devolvido', papeis: ['recepcao'], ator: 'u-re1', solicitacao_id: nova.id }));
await passo('arquivo recebe a devolução', D.moverProntuario({ prontuario_id: nova.prontuario_id, mov: 'recebido_devolucao', papeis: ['arquivo'], ator: 'u-ar1', solicitacao_id: nova.id }));
await passo('arquivo arquiva', D.moverProntuario({ prontuario_id: nova.prontuario_id, mov: 'arquivado', papeis: ['arquivo'], ator: 'u-ar1', solicitacao_id: nova.id, nota: 'estante A-10' }));
const prFim = (await D.obter('prontuarios', nova.prontuario_id)).data;
check(prFim.local === 'arquivo', 'prontuário arquivado depois do atendimento encerrado');

// ---------------------------------------------------------------- reabertura preserva histórico
console.log('\n## Reabertura e cancelamento preservam o histórico (RN-15, RN-20)');
const evAntes = (await D.listar('eventos', { solicitacao_id: nova.id })).data.length;
r = await D.moverSolicitacao({ id: nova.id, transicao: 'T16', papeis: ['callcenter'], ator: 'u-cc1', motivo: 'Paciente retornou com a mesma dúvida' });
check(!r.error && r.data.etapa === 'aberta' && r.data.reaberturas === 1, 'reabre e conta o retrabalho');
const evDepois = (await D.listar('eventos', { solicitacao_id: nova.id })).data.length;
check(evDepois === evAntes + 1, `histórico cresceu e nada foi apagado (${evAntes} → ${evDepois})`);
r = await D.moverSolicitacao({ id: nova.id, transicao: 'T15', papeis: ['callcenter'], ator: 'u-cc1' });
check(Boolean(r.error), 'cancelar sem motivo é recusado');

// ---------------------------------------------------------------- auditoria de leitura
console.log('\n## Auditoria registra LEITURA de dado clínico');
const audAntes = (await D.listar('auditoria')).data.length;
D.auditarLeitura(['recepcao'], 'avaliacao_medica', nova.id, 'u-re1');
const audDepois = (await D.listar('auditoria')).data;
check(audDepois.length === audAntes + 1 && audDepois.at(-1).acao === 'leitura', 'leitura de avaliação entra na auditoria');

// ---------------------------------------------------------------- telas depois de mexer nos dados
console.log('\n## Telas continuam íntegras depois de exercitar o fluxo');
trocarPapel('callcenter');
await abrirTela('painel.js');
check(body().includes('Olá'), 'a tela inicial do Call Center reabre, com a vez da equipe');
trocarPapel('admin');
await abrirTela('painel.js');
const painelAdmin = body();
check(painelAdmin.includes('Visão geral') && painelAdmin.includes('Quem tem acesso'), 'o Administrador vê o painel completo, com a equipe');
check(painelAdmin.includes('Últimas ações registradas'), 'e as últimas ações registradas');
trocarPapel('callcenter');
await abrirTela('solicitacao.js', 'initFicha', `solicitacoes/detalhe.html?id=${nova.id}`);
check(body().includes('Próxima ação'), 'detalhe reabre e mostra a próxima ação');

// ================================================================ 9. automação
//
// Cada verificação daqui para baixo corresponde a um clique, ou a uma digitação, que a equipe
// deixou de dar. São as partes do sistema que FAZEM em vez de pedir — e justamente por isso as
// que mais precisam de teste: automação errada é pior que trabalho manual, porque acontece sem
// ninguém olhando.
console.log('\n## Automação: o que o sistema passou a fazer sozinho');
const Filas = await mod('filas.js');
const Msg = await mod('mensagens.js');

// --- a etapa e a pasta andam juntas, e quem age vira dono
//
// O paciente é escolhido entre os que têm a pasta NO ARQUIVO e nenhum atendimento aberto: dois
// casos abertos disputando o mesmo prontuário são um estado que o processo não prevê, e montar o
// teste em cima dele mediria outra coisa.
const paraArquivo = async () => {
  const sols = (await D.listar('solicitacoes')).data;
  const ocupados = new Set(sols.filter(F.aberta).map((s) => s.paciente_id));
  const livre = (await D.listar('prontuarios')).data
    .find((p) => p.local === 'arquivo' && !p.solicitacao_id && !ocupados.has(p.paciente_id));
  if (!livre) throw new Error('o cenário do teste acabou: nenhum paciente com a pasta no arquivo');
  const s = (await D.abrirSolicitacao({ tipo: 'pedido_receita', paciente_id: livre.paciente_id, relato: 'teste de automação', papeis: ['callcenter'], ator: 'u-cc1' })).data;
  await D.moverSolicitacao({ id: s.id, transicao: 'T03', papeis: ['callcenter'], ator: 'u-cc1' });
  return s;
};
const auto = await paraArquivo();
r = await D.moverSolicitacao({ id: auto.id, transicao: 'T04', papeis: ['arquivo'], ator: 'u-ar1' });
check(Boolean(r.error), 'T04 é recusada enquanto a pasta não foi localizada nem retirada');
check((await D.obter('solicitacoes', auto.id)).data.etapa === 'aguardando_prontuario', 'e a recusa não moveu a etapa pela metade');
check(!(await D.obter('solicitacoes', auto.id)).data.assumido_por, 'o caso chega ao Arquivo sem dono: quem abriu já passou a vez');
await passo('o Arquivo registra que localizou', D.moverProntuario({ prontuario_id: auto.prontuario_id, mov: 'localizado', papeis: ['arquivo'], ator: 'u-ar1', solicitacao_id: auto.id }));
check((await D.obter('solicitacoes', auto.id)).data.assumido_por === 'u-ar1', 'e quem registrou virou dono do caso sem clicar em Assumir');
await D.moverProntuario({ prontuario_id: auto.prontuario_id, mov: 'retirado', papeis: ['arquivo'], ator: 'u-ar1', solicitacao_id: auto.id });
await passo('agora T04 passa, num clique só', D.moverSolicitacao({ id: auto.id, transicao: 'T04', papeis: ['arquivo'], ator: 'u-ar1' }));
const depois = (await D.dossie(auto.id)).data;
check(depois.prontuario.local === 'em_transito_para_recepcao', 'e a transição levou a pasta junto, sozinha (viaProntuario)');
check(depois.movimentos.some((m) => m.tipo === 'entregue'), 'com movimento de custódia gravado, não só a etapa mudada');
check(!depois.sol.assumido_por, 'ao passar para a Recepção, a posse do Arquivo se desfaz sozinha');

// --- prazo estourado vira aviso, e só uma vez
//
// A casca já roda esta varredura ao abrir qualquer tela, então a esta altura os atrasos semeados
// já viraram aviso. Para testar a CRIAÇÃO, o teste atrasa um caso de propósito.
D.db.solicitacoes.find((s) => s.id === auto.id).etapa_desde = new Date(Date.now() - 500 * 3600e3).toISOString();
const antesDeEscalonar = (await D.listar('avisos')).data.length;
const n1 = D.escalonarAtrasos();
const n2 = D.escalonarAtrasos();
const avisosAgora = (await D.listar('avisos')).data;
check(n1 >= 2, `o prazo estourado virou aviso para a equipe e para a coordenação (${n1} criado(s))`);
check(n2 === 0, 'e repetir a varredura não duplica: alerta que repete deixa de ser alerta');
check(avisosAgora.length === antesDeEscalonar + n1, 'nada foi criado por fora da conta');
check(avisosAgora.some((a) => a.solicitacao_id === auto.id && a.tipo === 'atraso'), 'a equipe da vez foi avisada');
check(avisosAgora.some((a) => a.solicitacao_id === auto.id && a.tipo === 'atraso_grave' && a.para_papel === 'admin'), 'e o dobro da meta sobe para a coordenação');

// --- posse de uma equipe não esconde o caso da outra
//
// Com "agir é assumir", quase todo caso em andamento passou a ter dono — e aí esta regra, que
// antes quase não era exercida, virou a diferença entre a Recepção ver ou não ver o trabalho
// dela. A etapa de entrega é das duas equipes: o Call Center define como a receita chega, a
// Recepção confirma a retirada.
const compartilhado = (await D.listar('solicitacoes')).data
  .find((s) => s.etapa === 'aguardando_entrega' && F.papeisDaEtapa(s).length > 1);
if (compartilhado) {
  D.db.solicitacoes.find((s) => s.id === compartilhado.id).assumido_por = 'u-cc1';
  const DP = await Filas.dadosDasFilas();
  const naFilaDe = (papel) => Filas.filasDoPapel(papel, DP)
    .map((f) => Filas.repartir(f, 'u-re1', papel))
    .some((f) => f.livres.some((it) => it.id === compartilhado.id));
  check(naFilaDe('recepcao'), 'caso assumido pelo Call Center continua solto na fila da Recepção');
  const naFilaDoCc = Filas.filasDoPapel('callcenter', DP)
    .map((f) => Filas.repartir(f, 'u-cc2', 'callcenter'))
    .some((f) => f.assumidos.some((it) => it.id === compartilhado.id));
  check(naFilaDoCc, 'e aparece como "já tem dono" para a própria equipe de quem assumiu');
}

// --- o que o sistema já sabe sobre o paciente
const comMedico = (await D.listar('solicitacoes')).data.find((s) => s.medico_nome);
const sug = D.sugestoesDoPaciente(comMedico.paciente_id);
check(sug.medico_nome === comMedico.medico_nome, 'o médico sugerido é o da última vez daquele paciente');
check(sug.atendimentos >= 1, 'e a sugestão diz em quantos atendimentos ela se baseia');

// --- o próximo caso
const DD = await Filas.dadosDasFilas();
const metasAtuais = D.configAtual().metas;
const prox = Filas.proximoCaso('arquivo', 'u-ar1', DD, metasAtuais);
check(Boolean(prox?.protocolo), 'o Arquivo tem um próximo caso para abrir');
check(F.papeisDaEtapa(prox).includes('arquivo'), 'e ele é mesmo da vez do Arquivo');
const deOutro = Filas.proximoCaso('arquivo', 'u-ninguem', DD, metasAtuais);
check(!deOutro || !deOutro.assumido_por, 'o próximo nunca é um caso que já tem outro dono');

// --- os recados que o sistema escreve
check(Msg.montar('Protocolo {protocolo} — {paciente}', { protocolo: 9, paciente: 'Fulana' }) === 'Protocolo 9 — Fulana', 'o modelo é preenchido com os dados do caso');
check(Msg.montar('vai {inexistente}', {}) === 'vai {inexistente}', 'chave sem valor fica visível em vez de sumir do recado');
check(Msg.numeroWhats('(11) 98100-0001') === '5511981000001', 'o telefone do paciente vira número de WhatsApp');
check(Msg.numeroWhats('123') === null, 'e número do qual não dá para ter certeza não vira link nenhum');
check(Msg.linkWhatsApp('oi', '(11) 98100-0001').startsWith('https://wa.me/5511981000001?text=oi'), 'o link abre a conversa certa com o texto pronto');
const salvou = await D.salvarConfig({ mensagens: { pedido_prontuario: 'Buscar {prontuario} para {paciente}.' }, papeis: ['admin'], ator: 'u-ad1' });
check(!salvou.error && salvou.data.mensagens.pedido_prontuario.startsWith('Buscar'), 'a clínica edita o texto dos recados');
check(Boolean((await D.salvarConfig({ mensagens: { pedido_prontuario: '  ' }, papeis: ['admin'], ator: 'u-ad1' })).error), 'e um modelo vazio é recusado');
check(Boolean((await D.salvarConfig({ mensagens: { inventado: 'x' }, papeis: ['admin'], ator: 'u-ad1' })).error), 'modelo desconhecido também');
check(D.prontuarioPorCodigo('pr-2001')?.codigo === 'PR-2001', 'o código bipado acha a pasta, sem ligar para maiúsculas');
check(D.prontuarioPorCodigo('não existe') === undefined, 'e um código que não existe não acha nada');

// --- as telas do lote e do formulário que digita menos
console.log('\n## Automação na tela');
await paraArquivo();
await paraArquivo();
trocarPapel('arquivo');
await abrirTela('filas.js');
const lote = doc.querySelector('.lote');
check(Boolean(lote) && !lote.hidden, 'a fila do Arquivo oferece trabalho em lote quando o passo é o mesmo para todos');
check(Boolean(doc.querySelector('.lote .bipe')), 'com campo para o leitor de código de barras');
check(doc.querySelectorAll('.qlista .lotechk').length >= 2, 'e uma caixa de seleção em cada linha');
check(/Registrar que localizou/.test(lote.textContent), 'o botão do lote diz qual passo vai aplicar');

trocarPapel('callcenter');
await abrirTela('solicitacoes.js');
const novoPedido = [...doc.querySelectorAll('.head .btn')].find((b) => b.textContent.includes('Pedido de receita'));
check(Boolean(novoPedido), 'o Call Center tem o botão de abrir pedido de receita');
clicar(novoPedido);
await wait(40);
check(Boolean(doc.querySelector('.ov datalist option')), 'o paciente se escolhe digitando, não rolando a lista inteira');
check(doc.querySelectorAll('.ov .rapidas .chip').length >= 3, 'e o relato tem as frases de sempre como botão');
const chip = doc.querySelector('.ov .rapidas .chip');
const relato = doc.querySelector('.ov [name="relato"]');
clicar(chip);
check(relato.value === chip.textContent, 'clicar na frase escreve o relato');
doc.querySelector('.ov').remove();

// --- cada papel vê só o que é do seu trabalho
console.log('\n## Telas por papel: o que cada um vê');
const cabecalhos = () => [...doc.querySelectorAll('th')].map((t) => t.textContent.trim());
const painelPorTitulo = (t) => [...doc.querySelectorAll('.panel')].find((p) => p.querySelector('h2')?.textContent === t);

trocarPapel('arquivo');
await abrirTela('painel.js');
check(Boolean(painelPorTitulo('Na vez da sua equipe')), 'o Arquivo vê só o que espera pela equipe dele na tela inicial');
check(!painelPorTitulo('Onde o trabalho está parado'), 'e não o volume das outras equipes');
check(!/Aguardando contato com o paciente/.test(painelPorTitulo('Na vez da sua equipe').textContent), 'sem etapa de outra equipe nesse painel');
await abrirTela('solicitacoes.js');
const colsArquivo = cabecalhos();
check(['Comunicação', 'Entrega', 'Aberta em'].every((c) => !colsArquivo.includes(c)), 'a lista do Arquivo não traz contato, entrega nem quem abriu');
check(colsArquivo.includes('Pendências') && colsArquivo.includes('Etapa atual'), 'mas mantém etapa e a pendência do prontuário');

trocarPapel('callcenter');
await abrirTela('solicitacoes.js');
check(['Comunicação', 'Entrega', 'Aberta em'].every((c) => cabecalhos().includes(c)), 'o Call Center continua vendo a lista completa');
trocarPapel('admin');
await abrirTela('painel.js');
check(Boolean(painelPorTitulo('Onde o trabalho está parado')), 'o Administrador continua vendo o painel inteiro');

// ================================================================ resultado
console.log('');
if (erros.length) console.log(`console.error inesperado: ${erros.length}`);
if (falhas.length || erros.length) {
  console.log(`✗ ${falhas.length} falha(s); console.error: ${erros.length}`);
  falhas.forEach((f) => console.log(' - ' + f));
  dom.window.close();
  process.exit(1);
}
console.log(`✓ tudo passou; console.error: 0`);
// As telas de fila instalam um relógio de novidades (js/atualiza.js). Fechar a janela do jsdom
// limpa os timers; sem isso o Node fica vivo depois do último check, esperando um intervalo que
// só faz sentido num navegador aberto.
dom.window.close();
