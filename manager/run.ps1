# Runs the manager once, headless: it plans every waiting goal into tasks, then stops.
# The manager's identity must be an operator in the live session. This script prints it;
# authorize it once on the dashboard (My team > Manage > Who can operate).
# Uses your Claude quota. Example:
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
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot\..").Path
$mcp = Join-Path $repo 'mcp'
if (-not $TokenFile) { $TokenFile = Join-Path $mcp ".tandem\manager-token-$Db" }
$node = (Get-Command node).Source
$tsxEsm = 'file:///' + ($mcp -replace '\\', '/') + '/node_modules/tsx/dist/esm/index.mjs'
$server = ($mcp -replace '\\', '/') + '/src/server.ts'

# who the manager is (also creates its saved login on first run)
$env:STDB_URI = $Uri; $env:STDB_DB = $Db; $env:TANDEM_SESSION = $Session; $env:TANDEM_TOKEN_FILE = $TokenFile
$identity = (& $node --import $tsxEsm (Join-Path $mcp 'src\whoami.ts') | Select-Object -Last 1).Trim()
Write-Host "Manager identity: $identity"
Write-Host "If goal tools are refused, authorize this identity on the dashboard."

$work = Join-Path $env:TEMP 'tandem-manager'
New-Item -ItemType Directory -Force $work | Out-Null
$cfgPath = Join-Path $work "mcp-$Db.json"
$cfg = @{ mcpServers = @{ tandem = @{ command = $node; args = @('--import', $tsxEsm, $server)
  env = @{ STDB_URI = $Uri; STDB_DB = $Db; TANDEM_SESSION = $Session; TANDEM_TOKEN_FILE = $TokenFile } } } }
$cfg | ConvertTo-Json -Depth 6 | Set-Content -Path $cfgPath -Encoding utf8

$prompt = Get-Content (Join-Path $PSScriptRoot 'PROMPT.md') -Raw
$prompt += "`n`nBegin now: call get_goals."
Push-Location $WorkDir
try {
  $out = $prompt | claude -p --model $Model --mcp-config $cfgPath --strict-mcp-config `
    --allowedTools mcp__tandem Read Glob Grep --max-budget-usd $MaxBudgetUsd 2>&1 | Out-String
} finally { Pop-Location }
if ($LogFile) { Set-Content -Path $LogFile -Value $out -Encoding utf8 }
Write-Host $out
