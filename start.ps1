# Starts Tandem with one command, then opens the page.
#
# Host a team on this computer:
#   .\start.ps1                 brain + page + manager + 2 workers (each task is a real Claude run)
#   .\start.ps1 -Simulate       workers fake the coding (no Claude calls for the work; good for demos)
#   .\start.ps1 -Lan            also let other computers on your network join (prints the address)
#   .\start.ps1 -Fresh          wipe the team's database first
# Join someone else's team from this computer (starts workers here that work for that team):
#   .\start.ps1 -Join ws://192.168.1.20:3001 -Db tandem-local
# Stop:
#   .\stop.ps1                  stops what this script started (add -All to stop the brain too)
param(
  [string]$Db = 'tandem-local',
  [string]$Join = '',
  [string]$Repo = '',
  [int]$Workers = 2,
  [switch]$Simulate,
  [switch]$NoManager,
  [switch]$Lan,
  [switch]$Fresh,
  [string]$Model = 'haiku',
  [string]$Budget = '0.50',
  [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
$state = Join-Path $root '.tandem'
$logs = Join-Path $state 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$pids = @()
$hosting = -not $Join
function Up($port) { [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Tsx($dir) { 'file:///' + ((Join-Path $root "$dir\node_modules\tsx\dist\esm\index.mjs") -replace '\\', '/') }
function Spawn($name, $file, $argList, $log) {
  $p = Start-Process -FilePath $file -ArgumentList $argList -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logs "$log.log") -RedirectStandardError (Join-Path $logs "$log.err")
  $script:pids += @{ name = $name; pid = $p.Id }
}

$needClaude = (-not $Simulate -and $Workers -gt 0) -or ($hosting -and -not $NoManager)
foreach ($tool in @('node', 'npm', 'git') + $(if ($hosting) { @('spacetime') } else { @() }) + $(if ($needClaude) { @('claude') } else { @() })) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "$tool is not installed or not on PATH. See README.md (Quick start)." + $(if ($tool -eq 'claude') { ' Or use -Simulate -NoManager.' } else { '' })
  }
}

Step 'Installing packages (first run only)'
foreach ($dir in 'brain\spacetimedb', 'brain', 'mcp', 'dashboard', 'launcher', 'manager') {
  if (-not (Test-Path (Join-Path $root "$dir\node_modules"))) {
    Write-Host "  npm install in $dir"
    Push-Location (Join-Path $root $dir); npm install --silent --no-fund --no-audit | Out-Null; Pop-Location
  }
}

if ($hosting) {
  Step 'Brain (SpacetimeDB)'
  $listen = if ($Lan) { '0.0.0.0:3001' } else { '127.0.0.1:3001' }
  if (-not (Up 3001)) {
    Spawn 'brain' 'spacetime' @('start', '--listen-addr', $listen) 'brain'
    for ($i = 0; $i -lt 40 -and -not (Up 3001); $i++) { Start-Sleep -Milliseconds 500 }
    if (-not (Up 3001)) { throw 'The brain did not start. See .tandem\logs\brain.err' }
    Write-Host "  started on $listen"
  } else {
    Write-Host '  already running'
    if ($Lan) { Write-Host '  note: it was started without -Lan; run .\stop.ps1 -All, then .\start.ps1 -Lan, to open it to your network' -ForegroundColor Yellow }
  }
  & spacetime server add dev3001 --url http://127.0.0.1:3001 --no-fingerprint 2>&1 | Out-Null
  $publish = @('publish', $Db, '--server', 'dev3001', '--no-config', '--module-path', (Join-Path $root 'brain\spacetimedb'), '--yes')
  if ($Fresh) { $publish += '--delete-data=always' }
  $out = & spacetime @publish 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { Write-Host $out; throw "Publishing $Db failed. If the schema changed, try .\start.ps1 -Fresh (this wipes $Db)." }
  Write-Host "  team '$Db' is ready"
  $uri = 'ws://127.0.0.1:3001'
} else {
  $uri = $Join
  Step "Joining $Db at $uri"
}

Step 'The page (http://localhost:5173)'
if (-not (Up 5173)) {
  Push-Location (Join-Path $root 'dashboard')
  Spawn 'page' 'npx.cmd' @('vite', '--port', '5173', '--strictPort') 'page'
  Pop-Location
  for ($i = 0; $i -lt 40 -and -not (Up 5173); $i++) { Start-Sleep -Milliseconds 500 }
  Write-Host '  started'
} else { Write-Host '  already running' }
$url = "http://localhost:5173/?db=$Db" + $(if ($hosting) { '' } else { "&uri=$([uri]::EscapeDataString($uri))" })

if (-not $Repo) { $Repo = Join-Path (Split-Path $root -Parent) 'tandem-playground' }
if ($Workers -gt 0 -or ($hosting -and -not $NoManager)) {
  if (-not (Test-Path (Join-Path $Repo '.git'))) {
    Step "Creating a playground repo for the workers: $Repo"
    New-Item -ItemType Directory -Force $Repo | Out-Null
    git -C $Repo init -q
    Set-Content -Path (Join-Path $Repo 'README.md') -Value '# Tandem playground' -Encoding ascii
    Set-Content -Path (Join-Path $Repo '.gitignore') -Value '.worktrees/' -Encoding ascii
    git -C $Repo add -A
    git -C $Repo -c user.name=tandem -c user.email=tandem@localhost commit -q -m 'Start'
  }
}

$env:STDB_URI = $uri; $env:STDB_DB = $Db; $env:TANDEM_SESSION = 'live'
if ($hosting -and -not $NoManager) {
  Step 'Manager (plans every goal you type)'
  $env:TANDEM_TOKEN_FILE = Join-Path $root "mcp\.tandem\manager-token-$Db"
  Spawn 'manager' 'node' @('--import', (Tsx 'manager'), (Join-Path $root 'manager\watch.ts'), '--repo', "`"$Repo`"", '--model', $Model, '--budget', $Budget) 'manager'
  Write-Host '  started. The first time, the page asks you to approve "Manager Claude".'
}

if ($Workers -gt 0) {
  Step ("$Workers worker(s)" + $(if ($Simulate) { ' (simulated: no Claude calls)' } else { " (real Claude runs, $Model)" }))
  $names = 'Alex', 'Sam', 'Jordan', 'Taylor', 'Riley', 'Casey'
  $offset = if ($hosting) { 0 } else { 3 }   # joiners get other names than the host's workers
  for ($i = 0; $i -lt $Workers; $i++) {
    $name = $names[($i + $offset) % $names.Count] + $(if ($hosting) { '' } else { "-$env:COMPUTERNAME".ToLower() })
    $env:TANDEM_TOKEN_FILE = Join-Path $root "mcp\.tandem\worker-$name-$Db"
    $env:LAUNCHER_MODEL = $Model; $env:LAUNCHER_BUDGET_USD = $Budget
    $nodeArgs = @('--import', (Tsx 'launcher'), (Join-Path $root 'launcher\launcher.ts'), '--name', $name, '--repo', "`"$Repo`"")
    if ($Simulate) { $nodeArgs += @('--simulate', '--sim-ms', '3000') }
    Spawn "worker $name" 'node' $nodeArgs "worker-$name"
    Write-Host "  $name"
  }
}

$old = @()
$pidFile = Join-Path $state 'pids.json'
if (Test-Path $pidFile) { $old = @(Get-Content $pidFile -Raw | ConvertFrom-Json) }
ConvertTo-Json -InputObject @(@($old) + $pids) -Depth 3 | Set-Content -Path $pidFile -Encoding utf8

Step 'Ready'
Write-Host "  Open $url"
if ($hosting) {
  Write-Host '  First time: click "Make me the owner", then approve "Manager Claude". Then describe what you want built.'
  if ($Lan) {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1).IPAddress
    Write-Host "  Others can open http://${ip}:5173/?db=$Db and join workers with: .\start.ps1 -Join ws://${ip}:3001 -Db $Db"
  }
}
Write-Host '  Logs: .tandem\logs   Stop: .\stop.ps1'
if (-not $NoBrowser) { Start-Process $url }
