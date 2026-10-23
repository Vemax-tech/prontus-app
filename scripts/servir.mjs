// Servidor estático sem dependências (só módulos do Node), para rodar o Prontus em qualquer máquina
// sem baixar nada. Segue as regras do serve.json: "/" → index.html, "/pasta" → /pasta/index.html.
//   node scripts/servir.mjs            (porta 3000, ou PORT=8080)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.env.PORT) || 3000;
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.webm': 'video/webm', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8',
};

async function arquivoDe(caminho) {
  let rel = decodeURIComponent(caminho.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const abs = path.join(RAIZ, rel);
  if (abs !== RAIZ && !abs.startsWith(RAIZ + path.sep)) return null;           // fora do projeto
  if (/(^|[\/])(\.git|node_modules|supabase|tests|scripts)([\/]|$)/.test(path.relative(RAIZ, abs))) return null;
  try {
    const s = await stat(abs);
    if (s.isFile()) return abs;
    if (s.isDirectory()) return arquivoDe(rel.replace(/\/?$/, '/'));
  } catch { /* não existe */ }
  return null;
}

createServer(async (req, res) => {
  try {
    const abs = await arquivoDe(req.url);
    if (!abs) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado'); }
    res.writeHead(200, { 'content-type': TIPOS[path.extname(abs)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(await readFile(abs));
  } catch (e) { res.writeHead(500); res.end(String(e)); }
}).listen(PORTA, () => console.log(`Prontus em http://localhost:${PORTA}  (Ctrl+C para parar)`))
  .on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `Porta ${PORTA} ocupada. Use PORT=<outra>.` : e.message); process.exit(1); });
