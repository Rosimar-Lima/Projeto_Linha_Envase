#requires -Version 7
[CmdletBinding()]
param(
    [string]$TaskName = "LinhaEnvaseIHM",
    [ValidateSet("AtStartup", "AtLogOn")]
    [string]$Trigger = "AtStartup"
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$launcher = Join-Path $PSScriptRoot "run-server.ps1"
$pwsh = (Get-Command pwsh -ErrorAction Stop).Source

if (-not (Test-Path -LiteralPath $launcher)) {
    throw "Launcher nao encontrado: $launcher"
}

Write-Host "Projeto : $root"
Write-Host "Launcher: $launcher"
Write-Host "Trigger : $Trigger"

$action = New-ScheduledTaskAction `
    -Execute $pwsh `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`"" `
    -WorkingDirectory $root

if ($Trigger -eq "AtStartup") {
    $triggerObj = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    Write-Host "Modo: SYSTEM no boot (sem login). Mantenha o projeto FORA do OneDrive." -ForegroundColor Yellow
} else {
    $triggerObj = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
    Write-Host "Modo: usuario atual no logon." -ForegroundColor Yellow
}

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $triggerObj `
    -Principal $principal `
    -Settings $settings `
    -Force | Out-Null

Write-Host "Tarefa '$TaskName' registrada. Inicie agora com: Start-ScheduledTask -TaskName $TaskName" -ForegroundColor Green
