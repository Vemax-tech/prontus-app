#!/usr/bin/env sh
# Atalho para macOS/Linux: ./iniciar.sh [--com-login | --testar]
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js não encontrado. Instale o Node 20+ (https://nodejs.org). Veja docs/instalacao.md"; exit 1; }
exec node scripts/iniciar.mjs "$@"
