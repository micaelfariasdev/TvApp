$ErrorActionPreference = 'Stop'
$remote = if ($env:TVBOX_REMOTE) { $env:TVBOX_REMOTE } else { 'ubuntu@164.152.62.129' }
$remoteDir = if ($env:TVBOX_REMOTE_DIR) { $env:TVBOX_REMOTE_DIR } else { '~/canais' }
$nextRemoteDir = if ($env:TVBOX_NEXT_REMOTE_DIR) { $env:TVBOX_NEXT_REMOTE_DIR } else { '~/canais-next' }
$root = Split-Path -Parent $PSScriptRoot

Write-Host "Enviando o servidor Express para ${remote}:${remoteDir}"
ssh $remote "mkdir -p $remoteDir/src $remoteDir/templates"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar o diretório remoto do Express.' }
scp "$root\canais\server.js" "$root\canais\package.json" "$root\canais\package-lock.json" "${remote}:${remoteDir}/"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao enviar os arquivos de runtime do Express.' }
scp -r "$root\canais\src\." "${remote}:${remoteDir}/src/"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao enviar o código-fonte do Express.' }
scp -r "$root\canais\templates\." "${remote}:${remoteDir}/templates/"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao enviar os templates do Express.' }
ssh $remote "cd $remoteDir && npm install --omit=dev && pm2 restart scraper --update-env"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao atualizar o serviço Express.' }

Write-Host "Enviando apenas os arquivos de runtime do Next.js para ${remote}:${nextRemoteDir}"
ssh $remote "mkdir -p $nextRemoteDir"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar o diretório remoto do Next.js.' }
scp `
  "$root\canais-next\package.json" `
  "$root\canais-next\package-lock.json" `
  "$root\canais-next\next.config.ts" `
  "$root\canais-next\tsconfig.json" `
  "$root\canais-next\server.cjs" `
  "$root\canais-next\ecosystem.config.cjs" `
  "${remote}:${nextRemoteDir}/"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao enviar os arquivos de runtime do Next.js.' }
scp -r "$root\canais-next\src" "$root\canais-next\public" "${remote}:${nextRemoteDir}/"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao enviar o código e os assets do Next.js.' }

ssh $remote "cd $nextRemoteDir && npm ci --include=dev && NODE_OPTIONS=--max-old-space-size=1536 npm run build && pm2 startOrReload ecosystem.config.cjs --only canais-next --update-env && pm2 save"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar ou iniciar o painel Next.js.' }

ssh $remote "curl --fail --silent --show-error http://127.0.0.1:4555/cinedark/login -o /dev/null && curl --fail --silent --show-error http://127.0.0.1:4555/cinedark/api/session"
if ($LASTEXITCODE -ne 0) { throw 'O painel Next.js não passou na verificação local de saúde.' }

Write-Host 'Deploy concluído. Banco, catálogo HLS, .env, node_modules e builds locais não foram enviados.'
