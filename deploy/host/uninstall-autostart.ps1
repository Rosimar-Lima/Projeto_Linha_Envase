#requires -Version 7
[CmdletBinding()]
param(
    [string]$TaskName = "LinhaEnvaseSplash"
)

$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "Tarefa '$TaskName' nao encontrada; nada a fazer."
    return
}

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop

Write-Host "Tarefa '$TaskName' removida." -ForegroundColor Green
