#requires -Version 7
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$server = Join-Path $root "server.js"
if (-not (Test-Path -LiteralPath $server)) {
    throw "server.js nao encontrado em $root"
}

$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "server.log"

$node = if ($env:LINEA_ENVASE_NODE) {
    $env:LINEA_ENVASE_NODE
} else {
    (Get-Command node -ErrorAction Stop).Source
}

Set-Location -LiteralPath $root

while ($true) {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -LiteralPath $logFile -Value "[$stamp] Iniciando ponte ADS (node $node)..."
    & $node $server *>> $logFile
    $code = $LASTEXITCODE
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -LiteralPath $logFile -Value "[$stamp] Ponte encerrada (exit $code); reiniciando em 5s."
    Start-Sleep -Seconds 5
}
