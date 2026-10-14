#!/usr/bin/env bash
set -euo pipefail

REMOTE="${TVBOX_REMOTE:-ubuntu@164.152.62.129}"
REMOTE_DIR="${TVBOX_REMOTE_DIR:-~/canais}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Enviando somente código e templates para ${REMOTE}:${REMOTE_DIR}"
ssh "$REMOTE" "mkdir -p ${REMOTE_DIR}/src ${REMOTE_DIR}/templates"

# Não enviar database.json, hls-channels.json, .env, uploads ou logs.
scp "$ROOT/canais/server.js" "$ROOT/canais/package.json" "$ROOT/canais/package-lock.json" "$REMOTE:${REMOTE_DIR}/"
scp -r "$ROOT/canais/src/." "$REMOTE:${REMOTE_DIR}/src/"
scp -r "$ROOT/canais/templates/." "$REMOTE:${REMOTE_DIR}/templates/"

ssh "$REMOTE" "cd ${REMOTE_DIR} && npm install --omit=dev && pm2 restart scraper --update-env"
echo "Deploy concluído; banco remoto preservado."
