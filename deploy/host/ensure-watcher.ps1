#requires -Version 7
<#
.SYNOPSIS
    Garante que o watcher da VM esteja rodando, lancando-o desacoplado do
    Agendador de Tarefas.

.DESCRIPTION
    O Agendador de Tarefas encerra processos de vida longa com codigo 0xC000013A
    em alguns cenarios. Para evitar isso, esta tarefa roda por poucos segundos e
    apenas garante que o watch-vm.ps1 esteja ativo, criando-o via WMI
    (Win32_Process.Create). Assim o watcher fica fora do Job do Agendador e
    sobrevive, na sessao interativa do usuario.

    E chamada pelo tarefa agendada a cada 1 minuto (watchdog) e no logon.
#>
[CmdletBinding()]
param(
    [string]$VmName = "TC3-FreeBSD",
    [string]$WatcherPath = (Join-Path $PSScriptRoot "watch-vm.ps1")
)

$ErrorActionPreference = "Stop"

$logFile = Join-Path $PSScriptRoot "watch-vm.log"
function Write-Log {
    param([string]$Message)
    try { Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message" } catch {}
}

if (-not (Test-Path -LiteralPath $WatcherPath)) {
    Write-Log "ensure-watcher: watch-vm.ps1 nao encontrado em $WatcherPath"
    exit 1
}

$mutex = New-Object System.Threading.Mutex($false, "Local\LinhaEnvaseSplashLauncher")
$locked = $false
try {
    $locked = $mutex.WaitOne(5000)
    if (-not $locked) { exit 0 }

    # O watcher segura "Local\LinhaEnvaseSplashWatcher" enquanto estiver vivo.
    # Se conseguirmos pegar o mutex, nao ha watcher rodando.
    $probe = New-Object System.Threading.Mutex($false, "Local\LinhaEnvaseSplashWatcher")
    $free = $false
    try { $free = $probe.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $free = $true }
    if ($free) {
        try { $probe.ReleaseMutex() } catch {}
        $probe.Dispose()
    }
    else {
        $probe.Dispose()
        exit 0
    }

    # Lanca o watcher por um VBS (wscript e app GUI, sem console) para que o
    # processo nasca com SW_HIDE e nao pisque nenhuma janela do PowerShell.
    $pwsh = (Get-Command pwsh -ErrorAction Stop).Source
    $vbsPath = Join-Path $PSScriptRoot "start-watcher.vbs"
    $vbsTemplate = @'
Set sh = CreateObject("WScript.Shell")
sh.Run """__PWSH__"" -NoProfile -ExecutionPolicy Bypass -File ""__WATCHER__"" -VmName ""__VM__""", 0, False
'@
    $vbs = $vbsTemplate.Replace("__PWSH__", $pwsh).Replace("__WATCHER__", $WatcherPath).Replace("__VM__", $VmName)
    [System.IO.File]::WriteAllText($vbsPath, $vbs, [System.Text.Encoding]::ASCII)

    $wscript = Join-Path $env:WINDIR "System32\wscript.exe"
    $cmdLine = "`"$wscript`" //B //nologo `"$vbsPath`""
    $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmdLine }
    if ($result.ReturnValue -eq 0) {
        Write-Log "ensure-watcher: watcher (re)lancado (pid $($result.ProcessId), via wscript oculto)."
    }
    else {
        Write-Log "ensure-watcher: falha ao lancar o watcher (ReturnValue=$($result.ReturnValue))."
    }
}
catch {
    Write-Log "ensure-watcher: erro: $($_.Exception.Message)"
}
finally {
    if ($locked) { try { $mutex.ReleaseMutex() } catch {} }
    $mutex.Dispose()
}
