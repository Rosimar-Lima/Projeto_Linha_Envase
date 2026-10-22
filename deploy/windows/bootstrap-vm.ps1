#requires -Version 7
<#
.SYNOPSIS
    Copia o projeto para a VM TwinCAT/BSD e executa o bootstrap (Node + servico).

.DESCRIPTION
    Um comando so, executado no Windows, para subir a IHM numa VM TwinCAT/BSD:
      1) envia os arquivos de runtime (server.js, src, IHM, PLC, config e deploy/bsd);
      2) roda deploy/bsd/bootstrap.sh na VM (pkg install node + install.sh).

    Requer OpenSSH cliente (ssh/scp) no Windows (padrao no Windows 10/11).

.PARAMETER VmHost
    IP ou host da VM. Default: 192.168.56.174

.PARAMETER User
    Usuario SSH da VM. Default: Administrator

.PARAMETER AppDir
    Destino do projeto na VM. Default: /opt/linha-envase

.EXAMPLE
    pwsh -File deploy\windows\bootstrap-vm.ps1
    pwsh -File deploy\windows\bootstrap-vm.ps1 -VmHost 192.168.56.174 -AppDir /opt/linha-envase
#>
[CmdletBinding()]
param(
    [string]$VmHost = "192.168.56.174",
    [string]$User = "Administrator",
    [string]$AppDir = "/opt/linha-envase"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command ssh -ErrorAction SilentlyContinue) -or
    -not (Get-Command scp -ErrorAction SilentlyContinue)) {
    throw "ssh/scp nao encontrados. Instale o recurso OpenSSH Client do Windows."
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$server = Join-Path $root "server.js"
if (-not (Test-Path -LiteralPath $server)) {
    throw "Projeto invalido: server.js nao encontrado em $root"
}

$dest = "$User@$VmHost"
$remoteSrc = "linha-envase-src"
$sshOpts = @("-o", "StrictHostKeyChecking=accept-new")

Write-Host "== 1/2 Enviando projeto para ${dest}:~/$remoteSrc ==" -ForegroundColor Cyan
ssh @sshOpts $dest "rm -rf ~/$remoteSrc && mkdir -p ~/$remoteSrc/deploy"

$files = @("server.js", "package.json", "package-lock.json", "plc.config.json")
$directories = @("src", "IHM", "PLC")
$required = @($files + $directories + "deploy/bsd")
$missing = $required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $root $_)) }
if ($missing) { throw "Itens ausentes no projeto: $($missing -join ', ')" }

Push-Location $root
try {
    scp @sshOpts @files "${dest}:$remoteSrc/"
    scp @sshOpts -r @directories "${dest}:$remoteSrc/"
    scp @sshOpts -r "deploy/bsd" "${dest}:$remoteSrc/deploy/"
}
finally {
    Pop-Location
}

Write-Host "== 2/2 Executando bootstrap na VM (Node + servico) ==" -ForegroundColor Cyan
ssh @sshOpts -t $dest "doas env APP_DIR=$AppDir sh ~/$remoteSrc/deploy/bsd/bootstrap.sh"

Write-Host "Concluido. Abra a IHM em http://${VmHost}:3000" -ForegroundColor Green
