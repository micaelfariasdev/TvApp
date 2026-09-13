param(
    [Parameter(Mandatory = $true)]
    [string] $Version,
    [Parameter(Mandatory = $true)]
    [int] $VersionCode
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$androidProject = Join-Path $projectRoot 'AndroidTVApp'
$tag = "v$($Version.Trim().TrimStart('v', 'V'))"
$apk = Join-Path $androidProject 'app\build\outputs\apk\debug\app-debug.apk'

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI não encontrada. Instale com: winget install GitHub.cli ; depois rode: gh auth login"
}

Push-Location $androidProject
try {
    $sdkRoot = "$env:LOCALAPPDATA\Android\Sdk"
    $env:ANDROID_HOME = $sdkRoot
    $env:ANDROID_SDK_ROOT = $sdkRoot
    .\gradlew.bat --no-daemon '-Pkotlin.incremental=false' :app:assembleDebug "-PappVersionName=$($tag.TrimStart('v'))" "-PappVersionCode=$VersionCode" --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar o APK.' }
} finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $apk)) { throw "APK não encontrado: $apk" }

Push-Location $projectRoot
try {
    # A listagem não falha quando a tag ainda não existe, diferentemente de
    # `gh release view`, que encerra o PowerShell por causa do ErrorActionPreference.
    $releaseTags = @(& gh release list --limit 1000 --json tagName --jq '.[].tagName')
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível consultar as releases do GitHub.' }

    # Cria a release caso a tag ainda não exista; nas próximas vezes substitui
    # somente o arquivo app-debug.apk daquela mesma release.
    if ($releaseTags -contains $tag) {
        gh release upload $tag $apk --clobber
    } else {
        gh release create $tag $apk --title "TV Box $tag" --generate-notes
    }
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível publicar a release no GitHub.' }
    Write-Host "Release $tag publicada com sucesso."
} finally {
    Pop-Location
}
