# Stops everything start.ps1 started (and the Claude runs those processes started).
#   .\stop.ps1          stop the manager, the workers and the page; leave the brain running
#   .\stop.ps1 -All     also stop the brain (SpacetimeDB)
param([switch]$All)
$pidFile = Join-Path $PSScriptRoot '.tandem\pids.json'
if (-not (Test-Path $pidFile)) { Write-Host 'Nothing to stop (no .tandem\pids.json).'; exit 0 }
# PowerShell 5.1 hands a JSON array to the pipeline as one object; ForEach-Object unrolls it.
$items = @((Get-Content $pidFile -Raw | ConvertFrom-Json) | ForEach-Object { $_ })
$keep = @()
foreach ($p in $items) {
  if ($p.name -eq 'brain' -and -not $All) { $keep += $p; continue }
  if (Get-Process -Id $p.pid -ErrorAction SilentlyContinue) {
    & taskkill /PID $p.pid /T /F 2>&1 | Out-Null
    Write-Host "stopped $($p.name)"
  }
}
if ($All) { Get-Process | Where-Object { $_.ProcessName -like 'spacetime*' } | Stop-Process -Force -ErrorAction SilentlyContinue; Write-Host 'stopped the brain' }
if ($keep.Count -gt 0) { ConvertTo-Json -InputObject @($keep) -Depth 3 | Set-Content -Path $pidFile -Encoding utf8 } else { Remove-Item $pidFile }
