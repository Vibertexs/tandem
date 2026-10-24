# THE FULL LOOP, with real headless Claude runs (haiku):
#   operator posts a goal -> manager Claude plans it into tasks -> two worker Claudes do them
#   -> everything is done, nothing collided -> the dashboard shows it.
# Publishes a FRESH dev database each run (default bilal-loop). Uses 3 Claude runs of quota.
# Edits only a throwaway repo. Needs: local server on dev3001, the dashboard dev server for the
# last check (npm run dev in dashboard/, port 5173), python on PATH for the produced tests.
param(
  [string]$Db = 'bilal-loop',
  [string]$Repo = 'C:\Code\scratch\loop-repo',
  [string]$Goal = 'Create a tiny Python calculator: calc.py with add(a, b) and sub(a, b), test_calc.py with unittest tests for both, and a README.md that explains how to use it.',
  [string]$UiUrl = 'http://localhost:5173',
  [string]$MaxBudgetUsd = '0.50'
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$mcp = Join-Path $root 'mcp'
$node = (Get-Command node).Source
$tsxEsm = 'file:///' + ($mcp -replace '\\', '/') + '/node_modules/tsx/dist/esm/index.mjs'
$server = ($mcp -replace '\\', '/') + '/src/server.ts'
$uri = 'ws://127.0.0.1:3001'
$work = Join-Path $env:TEMP ('tandem-loop-' + (Get-Date -Format 'HHmmss'))
New-Item -ItemType Directory -Force $work | Out-Null
$results = @()

Write-Host "== 1. fresh database $Db and an empty repo"
& spacetime publish $Db --server dev3001 --no-config --module-path (Join-Path $root 'brain\spacetimedb') --delete-data=always --yes 2>&1 | Out-Null
if (Test-Path $Repo) { Remove-Item -Recurse -Force $Repo }
New-Item -ItemType Directory -Force $Repo | Out-Null
git -C $Repo init -q
git -C $Repo -c user.name=loop -c user.email=loop@example.com commit -q --allow-empty -m init

Write-Host '== 2. operator authorizes the manager and posts the goal'
$managerToken = Join-Path $work 'manager.token'
$env:STDB_URI = $uri; $env:STDB_DB = $Db; $env:TANDEM_SESSION = 'live'; $env:TANDEM_TOKEN_FILE = $managerToken
$managerId = (& $node --import $tsxEsm (Join-Path $mcp 'src\whoami.ts') | Select-Object -Last 1).Trim()
$env:MANAGER_IDENTITY = $managerId; $env:GOAL_TEXT = $Goal
& $node --import $tsxEsm (Join-Path $PSScriptRoot 'loop-setup.ts')

Write-Host '== 3. manager Claude plans the goal (1 run)'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'manager\run.ps1') -Db $Db -TokenFile $managerToken -WorkDir $Repo -MaxBudgetUsd $MaxBudgetUsd -LogFile (Join-Path $work 'manager.log') | Select-Object -Last 8
& $node --import $tsxEsm (Join-Path $PSScriptRoot 'loop-verify.ts') plan $Repo
$results += $LASTEXITCODE

Write-Host '== 4. two worker Claudes do the tasks (2 runs, in parallel)'
$skill = (Get-Content (Join-Path $mcp 'skill\SKILL.md') -Raw) -replace '(?s)^---.*?---\s*', ''
$jobs = foreach ($w in @(@{ name = 'Alice'; plan = 'pro' }, @{ name = 'Bob'; plan = 'max' })) {
  $cfgPath = Join-Path $work "mcp-$($w.name).json"
  $cfg = @{ mcpServers = @{ tandem = @{ command = $node; args = @('--import', $tsxEsm, $server)
    env = @{ STDB_URI = $uri; STDB_DB = $Db; TANDEM_SESSION = 'live'; TANDEM_TOKEN_FILE = (Join-Path $work "$($w.name).token") } } } }
  $cfg | ConvertTo-Json -Depth 6 | Set-Content -Path $cfgPath -Encoding utf8
  $prompt = "$skill`n`nYour name is $($w.name). Your plan is $($w.plan). The repo root is the current directory. Begin."
  Start-Job -ArgumentList $Repo, $cfgPath, $prompt, (Join-Path $work "$($w.name).log"), $MaxBudgetUsd -ScriptBlock {
    param($repo, $cfgPath, $prompt, $log, $budget)
    Set-Location $repo
    $prompt | claude -p --model haiku --mcp-config $cfgPath --strict-mcp-config `
      --allowedTools mcp__tandem Read Write Edit Glob Grep --permission-mode acceptEdits `
      --max-budget-usd $budget *> $log
  }
}
$jobs | Wait-Job -Timeout 900 | Out-Null
$jobs | Where-Object State -eq 'Running' | Stop-Job
foreach ($n in 'Alice', 'Bob') { Write-Host "--- $n said:"; Get-Content (Join-Path $work "$n.log") -Tail 4 }
& $node --import $tsxEsm (Join-Path $PSScriptRoot 'loop-verify.ts') done $Repo
$results += $LASTEXITCODE

Write-Host '== 5. the dashboard shows it'
Push-Location (Join-Path $root 'dashboard')
$env:UI_URL = $UiUrl
& $node --import ('file:///' + ((Join-Path $root 'dashboard') -replace '\\', '/') + '/node_modules/tsx/dist/esm/index.mjs') test/loop-ui.ts
$results += $LASTEXITCODE
Pop-Location

Write-Host "logs: $work"
if (($results | Where-Object { $_ -ne 0 }).Count -eq 0) { Write-Host "`nLOOP PASSED" } else { Write-Host "`nLOOP FAILED ($($results -join ','))"; exit 1 }
