# Starts Tandem with one command, then opens the page.
#
# Host a team on this computer:
#   .\start.ps1                 brain + page + manager + 2 workers (each task is a real Claude run)
#   .\start.ps1 -Simulate       workers fake the coding (no Claude calls for the work; good for demos)
#   .\start.ps1 -Lan            also let other computers on your network join (prints the address)
#   .\start.ps1 -Fresh          wipe the team's database first
#   .\start.ps1 -Push           push task and goal branches to the repo's origin (needed when workers
#                               are on other computers; opens a PR per goal if the GitHub CLI is set up)
#   .\start.ps1 -Model auto     real workers pick the model by task difficulty (launcher/routing.json)
#                               instead of always using haiku (the cheap default)
#   .\start.ps1 -Notify <url>   post "goal done" to a Slack or Discord incoming webhook
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
  [switch]$Push,
  [switch]$Fresh,
  [string]$Model = 'haiku',
  [string]$ManagerModel = 'haiku',
  [string]$Budget = '0.50',
  [string]$Notify = '',
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
# What an earlier start.ps1 left running, so running it again does not start duplicates.
$pidFile = Join-Path $state 'pids.json'
$old = @()
if (Test-Path $pidFile) {
  # PowerShell 5.1 hands a JSON array to the pipeline as one object; ForEach-Object unrolls it.
  $old = @((Get-Content $pidFile -Raw | ConvertFrom-Json) | ForEach-Object { $_ } | Where-Object { Get-Process -Id $_.pid -ErrorAction SilentlyContinue })
}
function Running($name) { [bool]($old | Where-Object { $_.name -eq $name }) }
# Runs a native command. PowerShell 5.1 turns anything a tool prints on stderr (even a warning)
# into an error under 'Stop', so judge native tools by their exit code only.
function Native($exe, [string[]]$argList) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & $exe @argList 2>&1 | ForEach-Object { "$_" } | Out-String; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $old }
  return @{ out = $out; code = $code }
}
function Up($port) { [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Tsx($dir) { 'file:///' + ((Join-Path $root "$dir\node_modules\tsx\dist\esm\index.mjs") -replace '\\', '/') }
# Starts a background process that logs to .tandem\logs. It goes through ShellExecute so it does
# not inherit this script's handles: whoever ran start.ps1 (a terminal, a script, Claude Code)
# gets control back right away instead of waiting on the workers' output.
function Spawn($name, $file, [string[]]$argList, $log, $cwd = $root) {
  $quoted = ($argList | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
  $out = Join-Path $logs "$log.log"; $err = Join-Path $logs "$log.err"
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:ComSpec
  $psi.Arguments = "/d /s /c `"`"$file`" $quoted > `"$out`" 2> `"$err`"`""
  $psi.UseShellExecute = $true
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $psi.WorkingDirectory = $cwd
  $p = [System.Diagnostics.Process]::Start($psi)
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
    Push-Location (Join-Path $root $dir); $r = Native 'npm.cmd' @('install', '--silent', '--no-fund', '--no-audit'); Pop-Location
    if ($r.code -ne 0) { Write-Host $r.out; throw "npm install failed in $dir" }
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
  Native 'spacetime' @('server', 'add', 'dev3001', '--url', 'http://127.0.0.1:3001', '--no-fingerprint') | Out-Null
  $publish = @('publish', $Db, '--server', 'dev3001', '--no-config', '--module-path', (Join-Path $root 'brain\spacetimedb'), '--yes')
  if ($Fresh) { $publish += '--delete-data=always' }
  $r = Native 'spacetime' $publish
  if ($r.code -ne 0) { Write-Host $r.out; throw "Publishing $Db failed. If the schema changed, try .\start.ps1 -Fresh (this wipes $Db)." }
  Write-Host "  team '$Db' is ready"
  $uri = 'ws://127.0.0.1:3001'
} else {
  $uri = $Join
  Step "Joining $Db at $uri"
  # Can we reach the host's brain at all? (2 seconds, then a clear message instead of workers that die)
  $target = [uri]($uri -replace '^ws', 'http')
  $client = New-Object System.Net.Sockets.TcpClient
  $reached = $false
  try { $reached = $client.ConnectAsync($target.Host, $(if ($target.Port -gt 0) { $target.Port } else { 3001 })).Wait(2000) } catch { $reached = $false } finally { $client.Close() }
  if (-not $reached) {
    throw "Cannot reach the team at $uri. Check the address on the host's Team page, that the host started with -Lan, and that both computers are on the same network."
  }
  # Real workers here only help if their branches reach the host: a clone of the team's repo, pushed.
  if (-not $Simulate -and $Workers -gt 0 -and (-not $Repo -or -not $Push)) {
    Write-Host '  note: for real work, use a clone of the team''s repo and push: -Repo <your clone> -Push (the Team page shows the exact command). Otherwise add -Simulate.' -ForegroundColor Yellow
  }
}

Step 'The page (http://localhost:5173)'
if (-not (Up 5173)) {
  Spawn 'page' 'npx.cmd' @('vite', '--port', '5173', '--strictPort') 'page' (Join-Path $root 'dashboard')
  for ($i = 0; $i -lt 40 -and -not (Up 5173); $i++) { Start-Sleep -Milliseconds 500 }
  Write-Host '  started'
} else { Write-Host '  already running' }
# The network address others use, only if the brain really listens beyond this computer.
$ip = $null
if ($hosting -and $Lan -and (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in '0.0.0.0', '::' })) {
  # the adapter with a default gateway is the real network (not a VirtualBox or WSL one)
  $ip = @(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | ForEach-Object { $_.IPv4Address.IPAddress })[0]
}
$url = "http://localhost:5173/?db=$Db" + $(if ($hosting) { '' } else { "&uri=$([uri]::EscapeDataString($uri))" }) + $(if ($ip) { "&lan=$ip" } else { '' })

if (-not $Repo) { $Repo = Join-Path (Split-Path $root -Parent) 'tandem-playground' }
if ((-not $Simulate -and $Workers -gt 0) -or ($hosting -and -not $NoManager)) {
  if (-not (Test-Path (Join-Path $Repo '.git'))) {
    Step "Creating a playground repo for the workers: $Repo"
    New-Item -ItemType Directory -Force $Repo | Out-Null
    Native 'git' @('-C', $Repo, 'init', '-q') | Out-Null
    Set-Content -Path (Join-Path $Repo 'README.md') -Value '# Tandem playground' -Encoding ascii
    Set-Content -Path (Join-Path $Repo '.gitignore') -Value '.worktrees/' -Encoding ascii
    Native 'git' @('-C', $Repo, 'add', '-A') | Out-Null
    $c = Native 'git' @('-C', $Repo, '-c', 'user.name=tandem', '-c', 'user.email=tandem@localhost', 'commit', '-q', '-m', 'Start')
    if ($c.code -ne 0) { Write-Host $c.out; throw "Could not create the playground repo at $Repo" }
  }
}

$env:STDB_URI = $uri; $env:STDB_DB = $Db; $env:TANDEM_SESSION = 'live'
if ($hosting -and -not $NoManager -and (Running 'manager')) {
  Step 'Manager'; Write-Host '  already running'
} elseif ($hosting -and -not $NoManager) {
  Step 'Manager (plans every goal you type)'
  $env:TANDEM_TOKEN_FILE = Join-Path $root "mcp\.tandem\manager-token-$Db"
  $managerArgs = @('--import', (Tsx 'manager'), (Join-Path $root 'manager\watch.ts'), '--repo', $Repo, '--model', $ManagerModel, '--budget', $Budget)
  if ($Push) { $managerArgs += '--push' }
  if ($Notify) { $managerArgs += @('--notify', $Notify) }
  Spawn 'manager' 'node' $managerArgs 'manager'
  Write-Host '  started. The first time, "Make me the owner" on the page approves it too.'
}

if ($Workers -gt 0) {
  Step ("$Workers worker(s)" + $(if ($Simulate) { ' (simulated: no Claude calls)' } elseif ($Model -eq 'auto') { ' (real Claude runs, model by difficulty)' } else { " (real Claude runs, $Model)" }))
  $names = 'Alex', 'Sam', 'Jordan', 'Taylor', 'Riley', 'Casey'
  $offset = if ($hosting) { 0 } else { 3 }   # joiners get other names than the host's workers
  for ($i = 0; $i -lt $Workers; $i++) {
    $name = $names[($i + $offset) % $names.Count] + $(if ($hosting) { '' } else { "-$env:COMPUTERNAME".ToLower() })
    if (Running "worker $name") { Write-Host "  $name (already running)"; continue }
    $env:TANDEM_TOKEN_FILE = Join-Path $root "mcp\.tandem\worker-$name-$Db"
    if ($Model -eq 'auto') { Remove-Item Env:LAUNCHER_MODEL -ErrorAction SilentlyContinue } else { $env:LAUNCHER_MODEL = $Model }
    $env:LAUNCHER_BUDGET_USD = $Budget
    $nodeArgs = @('--import', (Tsx 'launcher'), (Join-Path $root 'launcher\launcher.ts'), '--name', $name, '--repo', $Repo)
    if ($Simulate) { $nodeArgs += @('--simulate', '--sim-ms', '3000') }
    if ($Push) { $nodeArgs += '--push' }
    Spawn "worker $name" 'node' $nodeArgs "worker-$name"
    Write-Host "  $name"
  }
}

ConvertTo-Json -InputObject @(@($old) + $pids) -Depth 3 | Set-Content -Path $pidFile -Encoding utf8

Step 'Ready'
Write-Host "  Open $url"
if ($hosting) {
  Write-Host '  First time: click "Make me the owner" (it also approves the manager). Then describe what you want built.'
  if ($ip) {
    Write-Host "  Others can open http://${ip}:5173/?db=$Db and join workers with: .\start.ps1 -Join ws://${ip}:3001 -Db $Db"
    Write-Host '  (If Windows asks whether node and spacetime may use the network, allow private networks.)'
  }
}
Write-Host '  Logs: .tandem\logs   Stop: .\stop.ps1'
if (-not $NoBrowser) { Start-Process $url }
