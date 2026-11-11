# Runs the Topo desktop installer for Windows (NSIS, docs/SCOPE.md D125) on
# a throwaway Windows machine (CI's windows-latest runner, builds.yml) and
# checks the "Use this PC as the server" path end to end:
#
#   1. silent install with /SERVER: the app in Program Files, the service
#      TopoServer installed (automatic, delayed, Local Service) and running,
#      %ProgramData%\Topo locked to Local Service, SYSTEM and Administrators,
#      the firewall rule, the server answering on 127.0.0.1:7380, the
#      installer's answer in the registry;
#   2. a silent reinstall without /SERVER keeps the service running;
#   3. silent uninstall: the service and firewall rule gone, the data kept.
#
#   pwsh tests/desktop-installer-windows.ps1 path\to\Topo_x.y.z_x64-setup.exe
#
# Needs an administrator (CI runners are). Never run it on a PC that matters.
param([Parameter(Mandatory = $true)][string]$Setup)
$ErrorActionPreference = 'Stop'
$script:fail = 0
$script:pass = 0
function Check($name, [bool]$cond, $detail = '') {
    if ($cond) { Write-Host "PASS :: $name"; $script:pass++ } else { Write-Host "FAIL :: $name $detail"; $script:fail++ }
}
function Answers() {
    try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:7380/api/health | Out-Null; return $true }
    catch { return [bool]$_.Exception.Response }
}
function WaitFor([scriptblock]$cond, [int]$seconds = 60) {
    for ($i = 0; $i -lt $seconds; $i++) { if (& $cond) { return $true }; Start-Sleep 1 }
    return [bool](& $cond)
}

$inst = Join-Path $env:ProgramFiles 'Topo'
$data = Join-Path $env:ProgramData 'Topo'

# ---- 1. install with the server ----
$p = Start-Process -FilePath $Setup -ArgumentList '/S', '/SERVER' -Wait -PassThru
Check 'the installer exits 0' ($p.ExitCode -eq 0) "($($p.ExitCode))"
Check 'the app in Program Files' (Test-Path (Join-Path $inst 'topo.exe'))
Check 'the bundled server beside it' (Test-Path (Join-Path $inst 'topo-desktop-server.exe'))
$svc = Get-CimInstance Win32_Service -Filter "Name='TopoServer'"
Check 'the service TopoServer is installed' ($null -ne $svc)
if ($svc) {
    Check 'automatic start' ($svc.StartMode -eq 'Auto') $svc.StartMode
    Check 'as Local Service' ($svc.StartName -match 'LocalService') $svc.StartName
    Check 'the bundled server, with its settings file' ($svc.PathName -match 'topo-desktop-server\.exe"? serve --config') $svc.PathName
    $delayed = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\TopoServer").DelayedAutostart
    Check 'delayed start' ($delayed -eq 1) "$delayed"
}
Check 'the service runs' (WaitFor { (Get-Service TopoServer -ErrorAction SilentlyContinue).Status -eq 'Running' } 60)
Check 'the server answers on 127.0.0.1:7380' (WaitFor { Answers } 60)
$acl = (Get-Acl $data).Access | ForEach-Object { $_.IdentityReference.Value }
Check '%ProgramData%\Topo: Local Service, SYSTEM, Administrators only' (($acl | Where-Object { $_ -notmatch 'LOCAL SERVICE|SYSTEM|Administrators' }).Count -eq 0) ($acl -join ', ')
Check 'a first topo.conf' (Test-Path (Join-Path $data 'topo.conf'))
$rule = Get-NetFirewallRule -DisplayName 'Topo server' -ErrorAction SilentlyContinue
Check 'the firewall rule' ($null -ne $rule)
if ($rule) { Check '…on private and domain networks only' (($rule.Profile.ToString() -match 'Private') -and ($rule.Profile.ToString() -notmatch 'Public|Any')) $rule.Profile }
$q = (Get-ItemProperty 'HKLM:\Software\Carino Systems\Topo' -ErrorAction SilentlyContinue).ServerQuestion
Check 'the installer recorded that it asked' ($q -eq 'asked') "$q"

# ---- 2. reinstall (an update) keeps it ----
$p = Start-Process -FilePath $Setup -ArgumentList '/S' -Wait -PassThru
Check 'a reinstall exits 0' ($p.ExitCode -eq 0) "($($p.ExitCode))"
Check 'the service is still there and runs again' (WaitFor { (Get-Service TopoServer -ErrorAction SilentlyContinue).Status -eq 'Running' } 90)

# ---- 3. uninstall ----
$un = Join-Path $inst 'uninstall.exe'
# _?= keeps the uninstaller in place, so -Wait waits for it.
$p = Start-Process -FilePath $un -ArgumentList '/S', "_?=$inst" -Wait -PassThru
Check 'the uninstaller exits 0' ($p.ExitCode -eq 0) "($($p.ExitCode))"
Check 'the service is gone' (WaitFor { $null -eq (Get-Service TopoServer -ErrorAction SilentlyContinue) } 90)
Check 'the firewall rule is gone' ($null -eq (Get-NetFirewallRule -DisplayName 'Topo server' -ErrorAction SilentlyContinue))
Check 'the data stays' (Test-Path (Join-Path $data 'topo.conf'))

Write-Host '---'
Write-Host "$($script:pass + $script:fail) checks, $($script:fail) failing"
if ($script:fail -gt 0) { exit 1 }
