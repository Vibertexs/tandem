# A real headless Claude (Bob) is told to edit notes.txt while Alice's task holds the lock.
# The lock-check hook must stop it. 1 haiku run. Edits only a throwaway repo.
# The hook is loaded for this one run with --settings (no settings file is changed).
param([string]$Repo = 'C:\Code\scratch\hook-real-repo', [string]$Db = 'bilal-dev', [string]$MaxBudgetUsd = '0.50')
$ErrorActionPreference = 'Stop'
$mcp = (Resolve-Path "$PSScriptRoot\..\..").Path
$node = (Get-Command node).Source
$tsxEsm = 'file:///' + ($mcp -replace '\\', '/') + '/node_modules/tsx/dist/esm/index.mjs'
$session = 'hk-' + (Get-Date -Format 'HHmmss')
$work = Join-Path $env:TEMP "tandem-$session"
New-Item -ItemType Directory -Force $work | Out-Null

if (Test-Path $Repo) { Remove-Item -Recurse -Force $Repo }
New-Item -ItemType Directory -Force $Repo | Out-Null
git -C $Repo init -q
Set-Content -Path (Join-Path $Repo 'notes.txt') -Value 'original notes' -Encoding ascii

$env:STDB_URI = 'ws://127.0.0.1:3001'; $env:STDB_DB = $Db; $env:TANDEM_SESSION = $session
& $node --import $tsxEsm (Join-Path $PSScriptRoot 'hook-setup.ts')

$hookCmd = '"' + $node + '" "' + (Join-Path $mcp 'hook\check-lock.mjs') + '"'
$settings = @{ hooks = @{ PreToolUse = @(@{ matcher = 'Edit|Write|MultiEdit|NotebookEdit'; hooks = @(@{ type = 'command'; command = $hookCmd }) }) } }
$settingsPath = Join-Path $work 'settings.json'
$settings | ConvertTo-Json -Depth 8 | Set-Content -Path $settingsPath -Encoding utf8

$env:TANDEM_WORKER_ID = 'w-bob'
Push-Location $Repo
$prompt = "Replace the whole content of notes.txt with the single line: changed by bob. If a tool call is blocked, do not try another way. Just say in one line what blocked you, then stop."
$out = $prompt | claude -p --model haiku --settings $settingsPath --allowedTools Read Edit Write --permission-mode acceptEdits --max-budget-usd $MaxBudgetUsd 2>&1 | Out-String
Pop-Location
Write-Host "--- Bob said:"; Write-Host $out.Trim()

$content = (Get-Content (Join-Path $Repo 'notes.txt') -Raw).Trim()
$fails = 0
if ($content -eq 'original notes') { Write-Host 'PASS  hook: notes.txt is unchanged (the edit was blocked)' } else { Write-Host "FAIL  hook: notes.txt changed to: $content"; $fails++ }
if ($out -match '(?i)lock|block') { Write-Host 'PASS  hook: Claude was told why (lock / blocked)' } else { Write-Host 'FAIL  hook: Claude did not mention the lock'; $fails++ }
if ($fails -eq 0) { Write-Host "`nHOOK PASSED" } else { Write-Host "`nHOOK FAILED"; exit 1 }
