// Prepara a stack local de login: aplica a migration, cria uma conta por papel e escreve
// js/config.local.js (ignorado pelo git) para o app falar com ela. Rode depois de `docker compose up -d`.
//   node supabase/local/preparar.mjs
// Senha e segredo abaixo valem SÓ para esta stack local; nada disto vai para produção.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL_LOCAL, SENHA_LOCAL, CONTAS, anonKey, servicoKey as servico } from './contas.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const psql = (sql, stdin) => spawnSync('docker', ['exec', '-i', 'prontus-auth-db-1', 'psql', '-U', 'postgres', '-d', 'prontus', '-v', 'ON_ERROR_STOP=1', '-q', ...(sql ? ['-c', sql] : ['-f', '-'])],
  { input: stdin, encoding: 'utf8' });

for (let i = 0; ; i++) {
  try { if ((await fetch(`${URL_LOCAL}/auth/v1/health`)).ok) break; } catch { /* ainda subindo */ }
  if (i > 40) throw new Error('a stack local não respondeu; rode `docker compose up -d` em supabase/local');
  await new Promise((r) => setTimeout(r, 1500));
}

// Todas as migrations, em ordem; cada uma é idempotente (create or replace / if not exists).
for (const arq of readdirSync(path.join(AQUI, '../migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  const mig = psql(null, readFileSync(path.join(AQUI, '../migrations', arq), 'utf8'));
  if (mig.status !== 0) throw new Error(`migration ${arq} falhou: ${mig.stderr}`);
}

for (const [email, nome, cargo, papel] of CONTAS) {
  const r = await fetch(`${URL_LOCAL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: anonKey, authorization: `Bearer ${servico}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: SENHA_LOCAL, email_confirm: true }),
  });
  const u = await r.json();
  const id = u.id || spawnSync('docker', ['exec', 'prontus-auth-db-1', 'psql', '-U', 'postgres', '-d', 'prontus', '-t', '-A', '-c',
    `select id from auth.users where email='${email}'`], { encoding: 'utf8' }).stdout.trim();
  if (!id) throw new Error(`não consegui criar ${email}: ${JSON.stringify(u)}`);
  const esc = (s) => s.replace(/'/g, "''");
  const p = psql(`insert into public.perfis (id, nome, cargo, papel) values ('${id}', '${esc(nome)}', '${esc(cargo)}', '${papel}')
    on conflict (id) do update set nome = excluded.nome, cargo = excluded.cargo, papel = excluded.papel, ativo = true`);
  if (p.status !== 0) throw new Error('perfil falhou: ' + p.stderr);
}
psql("notify pgrst, 'reload schema'");

writeFileSync(path.join(AQUI, '../../js/config.local.js'),
  `// GERADO por supabase/local/preparar.mjs — stack local, ignorado pelo git.\nexport default { url: '${URL_LOCAL}', anonKey: '${anonKey}' };\n`);
console.log(`Pronto. Contas locais (senha ${SENHA_LOCAL}):`);
CONTAS.forEach(([e, , , p]) => console.log(`  ${p.padEnd(10)} ${e}`));
