# Runs the manager once, headless (Windows wrapper around plan.ts, kept for scripts that use it).
# It plans every waiting goal into tasks, then stops. Uses your Claude quota. Example:
#   powershell -File manager/run.ps1 -Db bilal-dev
param(
  [string]$Uri = 'ws://127.0.0.1:3001',
  [string]$Db = 'bilal-dev',
  [string]$Session = 'live',
  [string]$TokenFile = '',
  [string]$WorkDir = (Get-Location).Path,
  [string]$Model = 'haiku',
  [string]$MaxBudgetUsd = '0.50',
  [string]$LogFile = ''
)
$tsx = 'file:///' + ((Join-Path $PSScriptRoot 'node_modules\tsx\dist\esm\index.mjs') -replace '\\', '/')
$planArgs = @('--import', $tsx, (Join-Path $PSScriptRoot 'plan.ts'), '--uri', $Uri, '--db', $Db, '--session', $Session,
  '--workdir', $WorkDir, '--model', $Model, '--budget', $MaxBudgetUsd)
if ($TokenFile) { $planArgs += @('--token-file', $TokenFile) }
if ($LogFile) { $planArgs += @('--log', $LogFile) }
& node @planArgs
exit $LASTEXITCODE
