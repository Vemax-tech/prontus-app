// Inicialização em um comando: confere os pré-requisitos, instala as dependências e sobe o Prontus.
//   node scripts/iniciar.mjs                 demonstração (dados fictícios em memória)
//   node scripts/iniciar.mjs --com-login     também sobe o login real no Docker (Postgres + Auth)
//   node scripts/iniciar.mjs --testar        roda a verificação e os testes e sai, sem servidor
// Só usa módulos do Node: funciona antes do `npm install`. Windows, macOS e Linux.
import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const win = process.platform === 'win32';
const passo = (m) => console.log(`\n▶ ${m}`);
const falha = (m) => { console.error(`\n✗ ${m}\n  Veja docs/instalacao.md.`); process.exit(1); };
const roda = (cmd, a, opc = {}) => spawnSync(cmd, a, { cwd: RAIZ, stdio: 'inherit', shell: win, ...opc });

passo('Conferindo pré-requisitos');
const [maior] = process.versions.node.split('.').map(Number);
if (maior < 20) falha(`Node ${process.versions.node} é antigo demais; é preciso Node 20 ou mais novo (https://nodejs.org).`);
console.log(`  Node ${process.versions.node} ✓`);
if (roda('npm', ['--version'], { stdio: 'pipe' }).status !== 0) falha('npm não encontrado (ele vem junto com o Node).');
console.log('  npm ✓');

passo('Instalando dependências');
// `npm ci` respeita o package-lock.json à risca: mesma versão em todas as máquinas.
const instalar = roda('npm', [existsSync(path.join(RAIZ, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund']);
if (instalar.status !== 0) falha('Falha ao instalar as dependências (confira a conexão com a internet).');

if (args.has('--testar')) {
  passo('Verificação estática'); if (roda('npm', ['run', 'check']).status !== 0) process.exit(1);
  passo('Testes das telas'); process.exit(roda('npm', ['test']).status ?? 1);
}

if (args.has('--com-login')) {
  passo('Subindo o login real (Docker)');
  if (roda('docker', ['--version'], { stdio: 'pipe' }).status !== 0) falha('Docker não encontrado. Instale o Docker Desktop (ou Docker Engine) ou rode sem --com-login.');
  if (roda('docker', ['info'], { stdio: 'pipe' }).status !== 0) falha('O Docker está instalado, mas não está em execução. Abra o Docker Desktop e tente de novo.');
  if (roda('npm', ['run', 'auth:local']).status !== 0) falha('Não foi possível preparar o login local.');
}

passo(`Iniciando o Prontus (porta ${process.env.PORT || 3000})`);
const srv = spawn(process.execPath, [path.join(RAIZ, 'scripts', 'servir.mjs')], { cwd: RAIZ, stdio: 'inherit' });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => srv.kill());
srv.on('exit', (c) => process.exit(c ?? 0));
