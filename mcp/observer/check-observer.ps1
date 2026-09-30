# check-observer.ps1
# Read-only health check for the observer. Changes nothing, stops nothing, sends nothing.
# Run from anywhere:
#
#   powershell -ExecutionPolicy Bypass -File mcp\observer\check-observer.ps1
#
# It answers four questions:
#   1. Is the Python environment there and complete?
#   2. Does .mcp.json point at files that exist?
#   3. Is QGroundControl running with MAVLink forwarding switched on?
#   4. Who holds UDP 14445, and is more than one observer running?

$ErrorActionPreference = 'Continue'
# this file is in <app>\mcp\observer
$root   = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$port   = 14445
$python = Join-Path $root 'mcp\observer\.venv\Scripts\python.exe'
$server = Join-Path $root 'mcp\observer\server.py'
$mcp    = Join-Path $root '.mcp.json'
$problems = @()

function Say($mark, $text) { Write-Host ("  [{0}] {1}" -f $mark, $text) }

Write-Host "App folder: $root"
Write-Host ""
Write-Host "1. Python environment"
if (Test-Path $python) {
    Say 'ok' "venv python found"
    $out = & $python -c "import sys, pymavlink, mcp; print(sys.version.split()[0])" 2>$null
    if ($LASTEXITCODE -eq 0) { Say 'ok' "pymavlink and mcp import (Python $out)" }
    else { Say '!!' "a package is missing; see README.md, Install"; $problems += 'packages missing from the venv' }
} else {
    Say '!!' "no environment at mcp\observer\.venv; see README.md, Install"
    $problems += 'venv missing'
}
if (Test-Path $server) { Say 'ok' "server.py found" } else { Say '!!' "server.py missing"; $problems += 'server.py missing' }

Write-Host ""
Write-Host "2. Registration (.mcp.json)"
if (Test-Path $mcp) {
    try {
        $cfg = Get-Content $mcp -Raw | ConvertFrom-Json
        $entry = $cfg.mcpServers.'flight-companion-observer'
        if ($null -eq $entry) { Say '!!' "no 'flight-companion-observer' entry"; $problems += '.mcp.json has no flight-companion-observer entry' }
        else {
            if (Test-Path (Join-Path $root $entry.command)) { Say 'ok' "command exists" }
            else { Say '!!' "command not found: $($entry.command)"; $problems += '.mcp.json command path is wrong' }
            foreach ($a in $entry.args) {
                if (Test-Path (Join-Path $root $a)) { Say 'ok' "script exists" }
                else { Say '!!' "script not found: $a"; $problems += '.mcp.json script path is wrong' }
            }
            if ($entry.env.QGC_FWD_PORT) { $port = [int]$entry.env.QGC_FWD_PORT }
            Say 'ok' "listening port is $port"
        }
    } catch { Say '!!' ".mcp.json does not parse as JSON"; $problems += '.mcp.json is not valid JSON' }
} else { Say '!!' ".mcp.json not found in the app folder"; $problems += '.mcp.json missing' }

Write-Host ""
Write-Host "3. QGroundControl"
$qgc = Get-Process | Where-Object { $_.ProcessName -like '*QGroundControl*' }
if ($qgc) { Say 'ok' "QGroundControl is running (PID $($qgc.Id -join ', '))" }
else { Say '--' "QGroundControl is not running; the observer will hear nothing until it is" }
$ini = Join-Path $env:APPDATA 'QGroundControl\QGroundControl.ini'
if (Test-Path $ini) {
    $fwd  = Select-String -Path $ini -Pattern '^forwardMavlink=(.*)$' | Select-Object -First 1
    $dest = Select-String -Path $ini -Pattern '^forwardMavlinkHostName=(.*)$' | Select-Object -First 1
    if ($fwd -and $fwd.Matches[0].Groups[1].Value -eq 'true') { Say 'ok' "MAVLink forwarding is switched on" }
    else { Say '!!' "MAVLink forwarding is off (Application Settings > MAVLink)"; $problems += 'QGC MAVLink forwarding is off' }
    if ($dest) {
        $h = $dest.Matches[0].Groups[1].Value
        if ($h -like "*:$port") { Say 'ok' "forwarding host is $h" }
        else { Say '!!' "forwarding host is $h, observer listens on $port"; $problems += 'QGC forwards to a different port than the observer listens on' }
    } else { Say 'ok' "forwarding host not saved, so QGC uses its default (localhost:14445)" }
} else { Say '--' "QGC settings file not found at $ini" }

Write-Host ""
Write-Host "4. UDP $port and running observers"
$owners = @(Get-NetUDPEndpoint -LocalPort $port -ErrorAction SilentlyContinue)
$observers = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -like '*observer*server.py*' -or $_.CommandLine -like '*qgc-readonly-mcp*server.py*' })
# A venv's python.exe starts the real interpreter as a child, so each observer shows
# up as two processes. Count the launchers: the ones whose parent is not an observer.
$ids = $observers | ForEach-Object { $_.ProcessId }
$launchers = @($observers | Where-Object { $ids -notcontains $_.ParentProcessId })

if ($owners.Count -eq 0) { Say '--' "nothing is listening on UDP $port (no observer running)" }
foreach ($o in $owners) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($o.OwningProcess)"
    Say 'ok' ("held by PID {0} ({1}), started {2}" -f $o.OwningProcess, $p.Name, $p.CreationDate)
}
foreach ($l in $launchers | Sort-Object CreationDate) {
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($l.ParentProcessId)"
    $child  = $observers | Where-Object { $_.ParentProcessId -eq $l.ProcessId } | Select-Object -First 1
    $holds  = $false
    foreach ($o in $owners) { if ($o.OwningProcess -eq $l.ProcessId -or ($child -and $o.OwningProcess -eq $child.ProcessId)) { $holds = $true } }
    $state = if ($holds) { 'HOLDS THE PORT' } else { 'starved, receives nothing' }
    Say '..' ("observer started {0}, launched by {1} (PID {2}): {3}" -f $l.CreationDate, $parent.Name, $l.ParentProcessId, $state)
}
if ($launchers.Count -gt 1) {
    Say '!!' "$($launchers.Count) observers are running; only the one holding the port receives data"
    $problems += "$($launchers.Count) observers running: close the extra assistant session(s); the one you keep recovers by itself"
}

Write-Host ""
if ($problems.Count -eq 0) { Write-Host "Result: nothing wrong found." }
else {
    Write-Host "Result: $($problems.Count) thing(s) to fix:"
    foreach ($p in $problems) { Write-Host "  - $p" }
}
