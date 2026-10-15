$ErrorActionPreference = 'Stop'
$remote = if ($env:TVBOX_REMOTE) { $env:TVBOX_REMOTE } else { 'ubuntu@164.152.62.129' }
$remoteDir = if ($env:TVBOX_REMOTE_DIR) { $env:TVBOX_REMOTE_DIR } else { '~/canais' }
$root = Split-Path -Parent $PSScriptRoot

Write-Host "Enviando código para ${remote}:${remoteDir} (estado remoto preservado)"
ssh $remote "mkdir -p $remoteDir/src $remoteDir/templates"
scp "$root\canais\server.js" "$root\canais\package.json" "$root\canais\package-lock.json" "${remote}:${remoteDir}/"
scp -r "$root\canais\src\." "${remote}:${remoteDir}/src/"
scp -r "$root\canais\templates\." "${remote}:${remoteDir}/templates/"
ssh $remote "cd $remoteDir && npm install --omit=dev && pm2 restart scraper --update-env"
Write-Host 'Deploy concluído; database.json, hls-channels.json e .env não foram enviados.'
