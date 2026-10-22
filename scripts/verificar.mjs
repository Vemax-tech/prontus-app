// Verificação estática do Prontus — faz o papel de um "lint" num projeto sem build:
//  1. todo .js passa em `node --check`;
//  2. todo import relativo aponta para um arquivo que existe;
//  3. toda página chama o boot.js com um módulo e uma função que existem e são exportados;
//  4. segurança: nenhum script embutido nas páginas, política de conteúdo presente no _headers;
//  5. todo item do menu aponta para uma página que existe;
//  6. todo var(--token) usado em CSS ou JS está definido em css/tokens.css — o guarda da identidade
//     visual: cor ou medida inventada numa tela quebra a coerência sem dar erro no navegador.
// Uso: npm run check
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const erros = [];
const falha = (m) => erros.push(m);
const rel = (p) => path.relative(RAIZ, p).replace(/\\/g, '/');

function listar(dir, ok) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const nome of readdirSync(dir)) {
    if (['node_modules', '.git', '.wrangler', 'vemax-skills', 'supabase'].includes(nome)) continue;
    const p = path.join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...listar(p, ok));
    else if (ok(p)) out.push(p);
  }
  return out;
}

const js = [...listar(path.join(RAIZ, 'js'), (p) => p.endsWith('.js')),
  ...listar(path.join(RAIZ, 'tests'), (p) => p.endsWith('.mjs')),
  ...listar(path.join(RAIZ, 'scripts'), (p) => p.endsWith('.mjs'))];
const paginas = listar(RAIZ, (p) => p.endsWith('.html'));
const css = listar(path.join(RAIZ, 'css'), (p) => p.endsWith('.css'));

// ---------------------------------------------------------------- 1. sintaxe
for (const f of js) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) falha(`sintaxe inválida em ${rel(f)}: ${(r.stderr || '').split('\n')[0]}`);
}

// ---------------------------------------------------------------- 2. imports relativos existem
for (const f of js) {
  const txt = readFileSync(f, 'utf8');
  for (const m of txt.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
    const alvo = path.resolve(path.dirname(f), m[1]);
    if (!existsSync(alvo)) falha(`import quebrado em ${rel(f)}: ${m[1]}`);
  }
}

// ---------------------------------------------------------------- 3. páginas e módulos
for (const p of paginas) {
  const txt = readFileSync(p, 'utf8');
  const m = /data-modulo="([^"]+)"\s+data-fn="([^"]+)"/.exec(txt);
  if (!m) { falha(`${rel(p)} não declara data-modulo/data-fn`); continue; }
  const [, modulo, fn] = m;
  const arquivo = path.join(RAIZ, 'js/modules', modulo + '.js');
  if (!existsSync(arquivo)) { falha(`${rel(p)} aponta para o módulo inexistente ${modulo}`); continue; }
  const fonte = readFileSync(arquivo, 'utf8');
  if (!new RegExp(`export\\s+(const|function|async function)\\s+${fn}\\b`).test(fonte)) {
    falha(`${rel(p)} chama ${modulo}.${fn}, que o módulo não exporta`);
  }
}

// ---------------------------------------------------------------- 4. segurança
for (const p of paginas) {
  const txt = readFileSync(p, 'utf8');
  for (const m of txt.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (m[2].trim()) falha(`${rel(p)} tem script embutido (a política de conteúdo não permite)`);
    if (!/\bsrc=/.test(m[1])) falha(`${rel(p)} tem <script> sem src`);
  }
}
const cab = existsSync(path.join(RAIZ, '_headers')) ? readFileSync(path.join(RAIZ, '_headers'), 'utf8') : '';
if (!/Content-Security-Policy:/.test(cab)) falha('_headers sem Content-Security-Policy');
if (!/Cache-Control:\s*no-store/.test(cab)) falha('_headers sem Cache-Control: no-store (o sistema trata dado de saúde)');
if (!/X-Robots-Tag:.*noindex/.test(cab)) falha('_headers sem X-Robots-Tag: noindex');
for (const f of js) {
  const txt = readFileSync(f, 'utf8');
  if (/\beval\s*\(|new Function\s*\(/.test(txt)) falha(`${rel(f)} usa eval ou new Function`);
  // innerHTML só é aceito com conteúdo fixo (o conjunto de ícones); nunca com dado interpolado.
  for (const m of txt.matchAll(/innerHTML\s*=\s*(.+)/g)) {
    if (/[`$+]/.test(m[1]) && !/icons\[n\]/.test(m[1])) falha(`${rel(f)} escreve innerHTML com valor montado: ${m[1].slice(0, 50)}`);
  }
}

// ---------------------------------------------------------------- 5. menu aponta para página existente
const ui = readFileSync(path.join(RAIZ, 'js/ui.js'), 'utf8');
const nav = /const NAV = \[([\s\S]*?)\n\];/.exec(ui);
if (!nav) falha('js/ui.js sem a lista NAV');
else {
  for (const m of nav[1].matchAll(/\[\s*'([^']*)'/g)) {
    const destino = path.join(RAIZ, m[1], 'index.html');
    if (!existsSync(destino)) falha(`menu aponta para "${m[1] || '/'}", que não tem index.html`);
  }
}

// ---------------------------------------------------------------- 6. tokens de estilo existem
const tokens = new Set();
const tk = readFileSync(path.join(RAIZ, 'css/tokens.css'), 'utf8');
for (const m of tk.matchAll(/(?:^|;)\s*(--[a-z0-9-]+)\s*:/gm)) tokens.add(m[1]);
// O próprio verificador fala de var(--token) em texto: fica de fora da varredura.
for (const f of [...css, ...js].filter((f) => !f.includes(`scripts`))) {
  const txt = readFileSync(f, 'utf8');
  for (const m of txt.matchAll(/var\((--[a-z0-9-]+)/g)) {
    if (!tokens.has(m[1])) falha(`${rel(f)} usa var(${m[1]}), que não existe em css/tokens.css`);
  }
}

// ---------------------------------------------------------------- resultado
if (erros.length) {
  console.log(`✗ ${erros.length} problema(s):`);
  erros.forEach((e) => console.log(' - ' + e));
  process.exit(1);
}
console.log(`✓ ${js.length} arquivos .js, ${paginas.length} páginas, ${css.length} folhas de estilo e ${tokens.size} tokens verificados.`);
