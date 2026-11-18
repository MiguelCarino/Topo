# Packs topo-monitor for Windows from an already built exe (docs/SCOPE.md D462):
#
#   packaging/build-windows.ps1 -Version 1.2.3 -Arch x64 -Exe target\release\topo-monitor.exe
#
# Run from desktop/monitor. Nothing is compiled here. Writes
# dist\topo-monitor-VERSION-windows-ARCH.zip: one folder holding
# topo-monitor.exe, README.txt and LICENSE, then checks what it wrote: the
# three files and nothing else, and, when the exe is this machine's own
# architecture, that the exe taken back out of the zip runs and says this
# version (an Arm exe built on an x64 machine cannot be run there, which is
# said). Not signed.
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][ValidateSet('x64', 'arm64')][string]$Arch,
    [Parameter(Mandatory = $true)][string]$Exe
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { throw "bad version '$Version' (MAJOR.MINOR.PATCH)" }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$mon = Split-Path -Parent $here
$root = Split-Path -Parent (Split-Path -Parent $mon)
if (-not (Test-Path $Exe)) { throw "missing $Exe (cargo build --release)" }

$name = "topo-monitor-$Version-windows-$Arch"
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("topo-monitor-pkg-" + [System.Guid]::NewGuid().ToString('N'))
$dir = Join-Path $work $name
New-Item -ItemType Directory -Force -Path $dir | Out-Null
try {
    Copy-Item $Exe (Join-Path $dir 'topo-monitor.exe')
    Copy-Item (Join-Path $here 'README-windows.txt') (Join-Path $dir 'README.txt')
    Copy-Item (Join-Path $root 'LICENSE') (Join-Path $dir 'LICENSE')
    $dist = Join-Path $mon 'dist'
    New-Item -ItemType Directory -Force -Path $dist | Out-Null
    $zip = Join-Path $dist "$name.zip"
    if (Test-Path $zip) { Remove-Item $zip }
    Compress-Archive -Path $dir -DestinationPath $zip -CompressionLevel Optimal

    # ---- What was written ----
    $fail = 0
    function Check([string]$what, [bool]$ok, [string]$more = '') {
        if ($ok) { Write-Host "PASS :: $what" } else { Write-Host "FAIL :: $what $more"; $script:fail++ }
    }
    $out = Join-Path $work 'out'
    Expand-Archive -Path $zip -DestinationPath $out
    $files = @(Get-ChildItem -Recurse -File $out | ForEach-Object { $_.FullName.Substring($out.Length + 1).Replace('\', '/') } | Sort-Object)
    $want = @("$name/LICENSE", "$name/README.txt", "$name/topo-monitor.exe")
    Check 'zip: one folder named for the version and the system, holding the exe, the README and the licence, and nothing else' (($files -join ',') -eq ($want -join ',')) ($files -join ', ')
    $readme = Get-Content -Raw (Join-Path $out "$name/README.txt")
    Check 'zip: the README says how to enrol and how to keep it running' (($readme -match 'topo-monitor\.exe enroll FILE') -and ($readme -match 'schtasks /Create'))
    $host64 = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    if ($host64 -eq $Arch) {
        $said = (& (Join-Path $out "$name/topo-monitor.exe") --version | Out-String).Trim()
        Check 'zip: the exe inside runs and says its version' ($said -eq "topo-monitor $Version") "(it said '$said')"
        # It keeps its files where it is told, and makes this PC's keys.
        $d = Join-Path $work 'data'
        $line = (& (Join-Path $out "$name/topo-monitor.exe") request --dir $d --name PACKAGE-CHECK 2>$null | Out-String).Trim()
        Check 'zip: request prints its line and keeps the keys in the folder given' (($line -match '^topo-monitor-request:[A-Za-z0-9_-]+$') -and (Test-Path (Join-Path $d 'secret.json'))) "(it printed '$line')"
        $status = (& (Join-Path $out "$name/topo-monitor.exe") status --dir $d | Out-String)
        Check 'zip: status says it is not enrolled yet' ($status -match 'not enrolled yet')
    } else {
        Write-Host "SKIP :: zip: the exe is $Arch and this machine is ${host64}: it was not run"
    }
    $size = [math]::Round((Get-Item $zip).Length / 1KB)
    Check 'zip: a plausible size (0.5 to 20 MB)' (($size -gt 500) -and ($size -lt 20000)) "($size KB)"
    Write-Host "--- $zip, $size KB, $fail failing"
    if ($fail -gt 0) { exit 1 }
} finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
