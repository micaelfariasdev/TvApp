#!/usr/bin/env bash
set -euo pipefail

REMOTE="${TVBOX_REMOTE:-ubuntu@164.152.62.129}"
REMOTE_DIR="${TVBOX_REMOTE_DIR:-~/canais}"
NEXT_REMOTE_DIR="${TVBOX_NEXT_REMOTE_DIR:-~/canais-next}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Enviando somente código e templates para ${REMOTE}:${REMOTE_DIR}"
ssh "$REMOTE" "mkdir -p ${REMOTE_DIR}/src ${REMOTE_DIR}/templates"

# Não enviar database.json, hls-channels.json, .env, uploads ou logs.
scp "$ROOT/canais/server.js" "$ROOT/canais/package.json" "$ROOT/canais/package-lock.json" "$REMOTE:${REMOTE_DIR}/"
scp -r "$ROOT/canais/src/." "$REMOTE:${REMOTE_DIR}/src/"
scp -r "$ROOT/canais/templates/." "$REMOTE:${REMOTE_DIR}/templates/"

ssh "$REMOTE" "cd ${REMOTE_DIR} && npm install --omit=dev && pm2 restart scraper --update-env"

echo "Enviando apenas os arquivos de runtime do Next.js para ${REMOTE}:${NEXT_REMOTE_DIR}"
ssh "$REMOTE" "mkdir -p ${NEXT_REMOTE_DIR}"
scp \
  "$ROOT/canais-next/package.json" \
  "$ROOT/canais-next/package-lock.json" \
  "$ROOT/canais-next/next.config.ts" \
  "$ROOT/canais-next/tsconfig.json" \
  "$ROOT/canais-next/server.cjs" \
  "$ROOT/canais-next/ecosystem.config.cjs" \
  "$REMOTE:${NEXT_REMOTE_DIR}/"
scp -r "$ROOT/canais-next/src" "$ROOT/canais-next/public" "$REMOTE:${NEXT_REMOTE_DIR}/"

ssh "$REMOTE" "cd ${NEXT_REMOTE_DIR} && npm ci --include=dev && NODE_OPTIONS=--max-old-space-size=1536 npm run build && pm2 startOrReload ecosystem.config.cjs --only canais-next --update-env && pm2 save"
ssh "$REMOTE" "curl --fail --silent --show-error http://127.0.0.1:4555/cinedark/login -o /dev/null && curl --fail --silent --show-error http://127.0.0.1:4555/cinedark/api/session"

echo "Deploy concluído. Banco, catálogo HLS, .env, node_modules e builds locais não foram enviados."
