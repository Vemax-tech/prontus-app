@echo off
rem Atalho para Windows: iniciar.cmd [--com-login | --testar]
cd /d "%~dp0"
where node >nul 2>&1 || (echo Node.js nao encontrado. Instale o Node 20+ em https://nodejs.org - veja docs\instalacao.md & exit /b 1)
node scripts\iniciar.mjs %*
