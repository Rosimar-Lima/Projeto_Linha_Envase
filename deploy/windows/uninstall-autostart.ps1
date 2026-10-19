#requires -Version 7
[CmdletBinding()]
param(
    [string]$TaskName = "LinhaEnvaseIHM"
)

$ErrorActionPreference = "Stop"

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Tarefa '$TaskName' removida." -ForegroundColor Green
} else {
    Write-Host "Tarefa '$TaskName' nao existe." -ForegroundColor Yellow
}
