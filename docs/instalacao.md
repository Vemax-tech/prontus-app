# Instalação e execução

O Prontus não tem build: o que é servido é HTML, CSS e módulos ES. O Node é usado para servir os arquivos e para rodar a verificação e os testes.

## Início rápido

Com o [Node.js](https://nodejs.org) 20 ou mais novo instalado, na pasta do projeto:

| Sistema | Comando |
|---|---|
| Windows | `iniciar.cmd` (duplo clique ou no terminal) |
| macOS / Linux | `./iniciar.sh` |
| Qualquer um | `npm start` (ou `node scripts/iniciar.mjs`) |

O script confere o Node, instala as dependências (`npm ci`, versões travadas no `package-lock.json`) e sobe o sistema em **http://localhost:3000**. `Ctrl+C` para parar. Para outra porta: `PORT=8080 ./iniciar.sh` (PowerShell: `$env:PORT=8080; .\iniciar.cmd`).

Sem login configurado, o sistema abre em **modo demonstração**, com dados fictícios em memória. Nenhum dado real existe no repositório.

## Pré-requisitos

| Item | Versão | Para quê | Obrigatório |
|---|---|---|---|
| Node.js (com npm) | 20 ou mais novo (`.nvmrc` indica a 20) | servir o sistema, verificação e testes | Sim |
| Git | qualquer recente | baixar o projeto | Sim, para clonar |
| Docker (Desktop ou Engine) com Compose v2 | recente | login real local: Postgres + Auth + PostgREST | Só com `--com-login`, `test:auth`, `test:banco`, `test:app` |
| Conta Cloudflare (Wrangler) | — | publicar (`npm run deploy`) | Só para publicar |

Internet é necessária na primeira instalação (pacotes npm e, com Docker, as imagens). Portas usadas: `3000` (sistema; configurável), e, com `--com-login`, `54321` (API) e `54322` (Postgres), ambas só em `127.0.0.1`.

## Dependências

- **Produção: nenhuma.** O navegador carrega só os arquivos do repositório.
- **Desenvolvimento** (`package.json` / `package-lock.json`): `jsdom` 26, usado apenas pelos testes. Instale com `npm ci`.
- **Docker** (`supabase/local/docker-compose.yml`): `postgres:16-alpine`, `supabase/gotrue`, `postgrest/postgrest`, `nginx:alpine`, com versões fixas.

## Modos de execução

```bash
npm start                    # demonstração (dados em memória)
npm start -- --com-login     # + login real local (precisa do Docker aberto)
npm start -- --testar        # instala, roda `check` + `test` e sai
```

Com `--com-login` o script sobe a stack, aplica as migrations, cria uma conta por papel e gera `js/config.local.js` (ignorado pelo git; só vale em localhost). Contas: `admin|callcenter|arquivo|recepcao@prontus.local`, senha `Prontus-Local-2026!` (apenas nesta stack local).

Comandos avulsos: `npm run dev` (só o servidor), `npm run check`, `npm test`, `npm run test:auth`, `npm run test:banco`, `npm run test:app` (estes três exigem a stack do Docker de pé), `npm run auth:local`.

Para derrubar o login local: `docker compose -f supabase/local/docker-compose.yml down` (acrescente `-v` para apagar os dados).

## Problemas comuns

| Sintoma | Solução |
|---|---|
| `node` / `npm` não reconhecido | Instale o Node 20+ e abra um terminal novo. |
| `Node X é antigo demais` | Atualize o Node (`nvm install` usa o `.nvmrc`). |
| `Porta 3000 ocupada` | Use outra: `PORT=8080`. |
| `Docker ... não está em execução` | Abra o Docker Desktop, espere ficar pronto e repita. |
| `permission denied` em `iniciar.sh` | `chmod +x iniciar.sh` ou use `sh iniciar.sh`. |
| Falha no `npm ci` | Confira internet/proxy; rode `npm install` para reconstruir o `node_modules`. |

Produção e publicação: veja o [README](../README.md) e [`publicacao.md`](publicacao.md).
