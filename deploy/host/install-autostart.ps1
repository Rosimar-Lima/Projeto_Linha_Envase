#requires -Version 7
[CmdletBinding()]
param(
    [string]$TaskName = "LinhaEnvaseSplash",
    [string]$VmName = "TC3-FreeBSD",
    [ValidateSet("AtLogOn", "AtStartup")]
    [string]$Trigger = "AtLogOn",
    # Limited = nao exige administrador. Use Highest somente executando o
    # PowerShell como Administrador (necessario apenas para AtStartup/SYSTEM).
    [ValidateSet("Limited", "Highest")]
    [string]$RunLevel = "Limited"
)

$ErrorActionPreference = "Stop"

$launcher = Join-Path $PSScriptRoot "ensure-watcher.ps1"
if (-not (Test-Path -LiteralPath $launcher)) {
    throw "ensure-watcher.ps1 nao encontrado em $launcher"
}
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "watch-vm.ps1"))) {
    throw "watch-vm.ps1 nao encontrado em $PSScriptRoot"
}

$pwsh = (Get-Command pwsh -ErrorAction Stop).Source

# Lancador VBS: wscript.exe e um aplicativo GUI (sem console), entao o
# Agendador nao pisca nenhuma janela a cada execucao do watchdog. O VBS inicia
# o ensure-watcher com janela oculta (0) e sem esperar (False).
$vbsPath = Join-Path $PSScriptRoot "ensure-watcher.vbs"
$runLine = 'sh.Run """' + $pwsh + '"" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""' + $launcher + '"" -VmName ""' + $VmName + '""", 0, False'
Set-Content -LiteralPath $vbsPath -Value @(
    'Set sh = CreateObject("WScript.Shell")'
    $runLine
) -Encoding ascii

$wscript = Join-Path $env:WINDIR "System32\wscript.exe"
$action = New-ScheduledTaskAction -Execute $wscript -Argument "//nologo `"$vbsPath`""

if ($Trigger -eq "AtStartup") {
    $triggers = @(New-ScheduledTaskTrigger -AtStartup)
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    Write-Warning "AtStartup roda como SYSTEM (sem sessao interativa) e NAO consegue abrir o navegador. Use AtLogOn para exibir a splash."
}
else {
    # Dois gatilhos:
    #  1) logon  -> comeca rapido quando o usuario entra;
    #  2) a cada 1 min -> watchdog: a tarefa roda poucos segundos e so garante
    #     que o watcher (desacoplado) esteja vivo. Se ele morrer, volta em <=1 min.
    # (Repeticao "enxertada" no gatilho de logon nao dispara de forma confiavel.)
    $logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $watchdogTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
        -RepetitionInterval (New-TimeSpan -Minutes 1) `
        -RepetitionDuration ([TimeSpan]::FromDays(3650))
    $triggers = @($logonTrigger, $watchdogTrigger)
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel $RunLevel
}

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -DontStopOnIdleEnd `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $triggers `
    -Principal $principal `
    -Settings $settings `
    -Force | Out-Null

Write-Host "Tarefa '$TaskName' registrada (gatilho: $Trigger, nivel: $RunLevel)." -ForegroundColor Green
Write-Host "Inicie agora com : Start-ScheduledTask -TaskName $TaskName"
Write-Host "Remova depois com: deploy\host\uninstall-autostart.ps1 -TaskName $TaskName"
Write-Host "Se der 'acesso negado', abra o PowerShell 7 como Administrador e rode de novo." -ForegroundColor Yellow
