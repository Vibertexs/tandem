# Two real headless Claude Code sessions against the local brain.
# Needs: local server on dev3001 and an EMPTY bilal-dev database.
# Uses your Claude quota (two short haiku runs). Edits only a throwaway repo.
param(
  [string]$Repo = 'C:\Code\scratch\e2e-repo',
  [string]$Work = "$env:TEMP\tandem-e2e"
)
$ErrorActionPreference = 'Stop'
$mcp = (Resolve-Path "$PSScriptRoot\..\..").Path
$node = (Get-Command node).Source
$tsxEsm = "file:///" + ($mcp -replace '\\','/') + "/node_modules/tsx/dist/esm/index.mjs"
$server = ($mcp -replace '\\','/') + "/src/server.ts"

if (Test-Path $Repo) { Remove-Item -Recurse -Force $Repo }
New-Item -ItemType Directory -Force $Repo, $Work | Out-Null
git -C $Repo init -q
git -C $Repo -c user.name=e2e -c user.email=e2e@example.com commit -q --allow-empty -m init

$session = "e2e-" + (Get-Date -Format 'HHmmss')
$env:TANDEM_SESSION = $session
$cfg = @{ mcpServers = @{ tandem = @{ command = $node; args = @('--import', $tsxEsm, $server); env = @{ TANDEM_SESSION = $session } } } } | ConvertTo-Json -Depth 6
$cfgPath = "$Work\mcp.json"
Set-Content -Path $cfgPath -Value $cfg -Encoding utf8

Push-Location $mcp
npx tsx test/e2e/seed.ts
Pop-Location

$rules = Get-Content "$PSScriptRoot\rules.md" -Raw
$workers = @(@{ name = 'Alice'; plan = 'pro' }, @{ name = 'Bob'; plan = 'max' })
$jobs = foreach ($w in $workers) {
  $prompt = "$rules`n`nYour name is $($w.name). Your plan is $($w.plan). Begin."
  Start-Job -ArgumentList $Repo, $cfgPath, $prompt, $w.name, $Work -ScriptBlock {
    param($repo, $cfgPath, $prompt, $name, $work)
    Set-Location $repo
    $prompt | claude -p --model haiku --mcp-config $cfgPath --strict-mcp-config `
      --allowedTools mcp__tandem Read Write Edit --permission-mode acceptEdits `
      --max-budget-usd 0.5 *> "$work\$name.log"
  }
}
$jobs | Wait-Job -Timeout 420 | Out-Null
$jobs | Where-Object State -eq 'Running' | Stop-Job
foreach ($w in $workers) { Write-Host "--- $($w.name) said:"; Get-Content "$Work\$($w.name).log" -Tail 6 }

Push-Location $mcp
npx tsx test/e2e/verify.ts $Repo
Pop-Location
