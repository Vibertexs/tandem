# Runs every test suite and prints one summary.
#   .\test.ps1            all automated suites (no Claude calls; about 6 minutes)
#   .\test.ps1 -Real      also the suites that make real headless Claude runs (haiku, uses quota)
#   .\test.ps1 -Restart   also the brain-restart test (stops and restarts the local brain)
# Needs the local brain on 127.0.0.1:3001 (started here if it is not running) and Chrome for the
# page tests. Test databases are all named bilal-* and are wiped freely.
param([switch]$Real, [switch]$Restart)
$root = $PSScriptRoot
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
function Up($port) { [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }

if (-not (Up 3001)) {
  Write-Host 'starting the local brain...'
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:ComSpec; $psi.Arguments = '/d /c spacetime start --listen-addr 127.0.0.1:3001'
  $psi.UseShellExecute = $true; $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  [void][System.Diagnostics.Process]::Start($psi)
  for ($i = 0; $i -lt 40 -and -not (Up 3001); $i++) { Start-Sleep -Milliseconds 500 }
}
& spacetime server add dev3001 --url http://127.0.0.1:3001 --no-fingerprint 2>&1 | Out-Null
& spacetime publish bilal-dev --server dev3001 --no-config --module-path (Join-Path $root 'brain\spacetimedb') --yes 2>&1 | Out-Null

# the page tests use the production build on port 4173
Push-Location (Join-Path $root 'dashboard'); & npm.cmd run build 2>&1 | Out-Null; Pop-Location
if (-not (Up 4173)) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:ComSpec; $psi.Arguments = '/d /c npx vite preview --port 4173 --strictPort'
  $psi.WorkingDirectory = Join-Path $root 'dashboard'
  $psi.UseShellExecute = $true; $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  [void][System.Diagnostics.Process]::Start($psi)
  for ($i = 0; $i -lt 40 -and -not (Up 4173); $i++) { Start-Sleep -Milliseconds 500 }
}

$suites = @(
  @('brain', 'brain', 'npm.cmd run test'),
  @('brain: who may do what', 'brain', 'npm.cmd run test:auth'),
  @('mcp: mock mode', 'mcp', 'npm.cmd run test:mock'),
  @('mcp: 16 tools, real brain', 'mcp', 'npm.cmd run test'),
  @('mcp: manager identity', 'mcp', 'npm.cmd run test:operator'),
  @('mcp: lock-check hook', 'mcp', 'npm.cmd run test:hook'),
  @('launcher', 'launcher', 'npm.cmd run test'),
  @('manager: merge, test, finish', 'manager', 'npm.cmd run test'),
  @('page in Chrome', 'dashboard', 'npx.cmd tsx test/ui.test.ts')
)
if ($Restart) { $suites += , @('page + worker survive a brain restart', 'dashboard', 'npx.cmd tsx test/reconnect.test.ts') }
if ($Real) {
  $suites += , @('REAL: start.ps1, a goal, simulated workers (1 run)', 'dashboard', 'npx.cmd tsx test/start-flow.ts')
  $suites += , @('REAL: hook blocks a real Claude (1 run)', 'mcp', 'powershell -NoProfile -ExecutionPolicy Bypass -File test/e2e/hook-real.ps1')
  $suites += , @('REAL: launcher in a worktree (1 run)', 'launcher', 'npx.cmd tsx test/real.ts')
}

$rows = @(); $failed = 0
foreach ($s in $suites) {
  $name, $dir, $cmd = $s
  Write-Host -NoNewline ("{0,-52}" -f $name)
  Push-Location (Join-Path $root $dir)
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $out = Invoke-Expression "$cmd 2>&1" | ForEach-Object { "$_" }
  $code = $LASTEXITCODE
  $ErrorActionPreference = $old
  Pop-Location
  $pass = @($out | Where-Object { $_ -match '^PASS' }).Count
  $fail = @($out | Where-Object { $_ -match '^FAIL' }).Count
  $ok = ($code -eq 0 -and $fail -eq 0)
  if (-not $ok) { $failed++ }
  Write-Host ("{0,4} passed  {1}" -f $pass, $(if ($ok) { 'OK' } else { "FAILED ($fail)" })) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })
  if (-not $ok) { $out | Where-Object { $_ -match '^FAIL|Error' } | Select-Object -First 5 | ForEach-Object { Write-Host "      $_" -ForegroundColor Red } }
  $rows += [pscustomobject]@{ suite = $name; passed = $pass; ok = $ok }
}
$total = ($rows | Measure-Object -Property passed -Sum).Sum
Write-Host ''
if ($failed -eq 0) { Write-Host "ALL $($rows.Count) SUITES PASSED ($total checks)" -ForegroundColor Green } else { Write-Host "$failed of $($rows.Count) suites FAILED" -ForegroundColor Red; exit 1 }
