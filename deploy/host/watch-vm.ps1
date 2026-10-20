#requires -Version 7
<#
.SYNOPSIS
    Abre automaticamente a tela de inicializacao (splash) quando a VM sobe.

.DESCRIPTION
    Roda em segundo plano no host Windows. Fica observando o VirtualBox; quando
    a VM informada (ex.: TC3-FreeBSD) passa de "desligada" para "ligada", abre o
    navegador em modo kiosk apontando para deploy/host/splash.html (local no host).

    Usa um perfil dedicado do navegador (deploy/host/.kiosk-profile) para que o
    kiosk sempre abra, mesmo que voce ja tenha janelas do navegador abertas.

    A splash usa o proprio WebSocket da IHM (VM:3000) para saber a prontidao e,
    ao final, carrega a tela da linha (http://<VM>:3000).

    Instale o autostart com: deploy\host\install-autostart.ps1
    Log: deploy\host\watch-vm.log

.EXAMPLE
    pwsh -File deploy\host\watch-vm.ps1
    pwsh -File deploy\host\watch-vm.ps1 -VmName "TC3-FreeBSD" -NoKiosk
#>
[CmdletBinding()]
param(
    [string]$VmName = "TC3-FreeBSD",
    [string]$VBoxManage,
    [string]$SplashPath = (Join-Path $PSScriptRoot "splash.html"),
    [string]$Browser,
    [string]$ProfileDir = (Join-Path $PSScriptRoot ".kiosk-profile"),
    [switch]$NoKiosk,
    [bool]$CloseOnStop = $true,
    [int]$PollSeconds = 3
)

$ErrorActionPreference = "Stop"

# Instancia unica: o watcher segura este mutex enquanto estiver vivo. Se outro
# watcher ja estiver rodando, este encerra silenciosamente.
$script:watcherMutex = New-Object System.Threading.Mutex($false, "Local\LinhaEnvaseSplashWatcher")
$acquired = $false
try { $acquired = $script:watcherMutex.WaitOne(0) }
catch [System.Threading.AbandonedMutexException] { $acquired = $true }
if (-not $acquired) { exit 0 }

$logFile = Join-Path $PSScriptRoot "watch-vm.log"
function Write-Log {
    param([string]$Message)
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
    try { Add-Content -LiteralPath $logFile -Value $line } catch {}
    Write-Host $line
}

function Resolve-VBoxManage {
    if ($VBoxManage -and (Test-Path -LiteralPath $VBoxManage)) { return $VBoxManage }
    $cmd = Get-Command VBoxManage -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $default = "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"
    if (Test-Path -LiteralPath $default) { return $default }
    throw "VBoxManage nao encontrado. Informe o caminho com -VBoxManage."
}

function Resolve-Browser {
    if ($Browser -and (Test-Path -LiteralPath $Browser)) { return $Browser }
    $candidates = @(
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    foreach ($path in $candidates) {
        if ($path -and (Test-Path -LiteralPath $path)) { return $path }
    }
    throw "Navegador (Edge/Chrome) nao encontrado. Informe com -Browser."
}

function Test-VmRunning {
    param([string]$Exe, [string]$Name)
    $output = & $Exe list runningvms 2>$null
    return [bool]($output -match "\x22$([regex]::Escape($Name))\x22")
}

function Stop-Kiosk {
    # Fecha apenas as janelas do navegador abertas com o NOSSO perfil dedicado,
    # sem tocar nas janelas pessoais do usuario.
    try {
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -in @("msedge.exe", "chrome.exe") -and $_.CommandLine -like "*$ProfileDir*" } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    }
    catch {}
}

$vbox = Resolve-VBoxManage
$browserExe = Resolve-Browser
if (-not (Test-Path -LiteralPath $SplashPath)) {
    throw "splash.html nao encontrado em $SplashPath"
}
$splashFull = (Resolve-Path -LiteralPath $SplashPath).Path
$splashUrl = ([System.Uri]$splashFull).AbsoluteUri

if (-not (Test-Path -LiteralPath $ProfileDir)) {
    New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
}

Write-Log "== watch-vm iniciado =="
Write-Log "VM       : $VmName"
Write-Log "VBox     : $vbox"
Write-Log "Navegador: $browserExe"
Write-Log "Perfil   : $ProfileDir"
Write-Log "Splash   : $splashUrl"
Write-Log "Kiosk    : $(-not $NoKiosk)"

$browserProcess = $null
$wasRunning = $false
try { $wasRunning = Test-VmRunning -Exe $vbox -Name $VmName } catch { $wasRunning = $false }
$pollCount = 0
Write-Log "Estado inicial: VM $(if ($wasRunning) { 'ligada' } else { 'desligada' }) (sem abrir a splash ao iniciar o watcher)."
Write-Log "Monitorando '$VmName' a cada $PollSeconds s (heartbeat a cada $([int]($PollSeconds * 100)) s)."

while ($true) {
    try {
        try {
            $running = Test-VmRunning -Exe $vbox -Name $VmName
        }
        catch {
            Write-Log "Falha ao consultar o VirtualBox: $($_.Exception.Message)"
            $running = $false
        }

        if ($running -and -not $wasRunning) {
            Write-Log "VM '$VmName' ligada; abrindo a splash."
            Stop-Kiosk
            Start-Sleep -Milliseconds 400
            $argList = if ($NoKiosk) {
                @("--user-data-dir=`"$ProfileDir`"", $splashUrl)
            }
            else {
                @("--user-data-dir=`"$ProfileDir`"", "--no-first-run", "--no-default-browser-check", "--kiosk", $splashUrl)
            }
            try {
                $browserProcess = Start-Process -FilePath $browserExe -ArgumentList $argList -PassThru
                Write-Log "Navegador iniciado (pid $($browserProcess.Id))."
            }
            catch {
                Write-Log "Falha ao abrir o navegador: $($_.Exception.Message)"
            }
        }
        elseif (-not $running -and $wasRunning) {
            Write-Log "VM '$VmName' desligada."
            if ($CloseOnStop) { Stop-Kiosk }
            $browserProcess = $null
        }

        $wasRunning = $running
        $pollCount++
        if ($pollCount % 100 -eq 0) {
            Write-Log "heartbeat: VM $(if ($running) { 'ligada' } else { 'desligada' }) (pid $PID)."
        }
    }
    catch {
        Write-Log "ERRO inesperado no loop: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds $PollSeconds
}
