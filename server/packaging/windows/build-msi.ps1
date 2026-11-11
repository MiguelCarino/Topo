# Builds the Topo server MSI on Windows (WiX Toolset v4 or later). A recipe:
# not run on the machine that wrote it (no Windows there); docs/SERVER.md,
# "Install on Windows", says so.
#
#   cd server
#   make windows            (or: GOOS=windows GOARCH=amd64 go build ... on any OS)
#   dotnet tool install --global wix
#   wix extension add -g WixToolset.Util.wixext
#   powershell -File packaging\windows\build-msi.ps1 -Version 1.2.3 -Arch x64
#
# Writes dist\topo-server-<Version>-<Arch>.msi. Not signed: signing
# (signtool with an Authenticode certificate) is a later step.
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [ValidateSet('x64', 'arm64')][string]$Arch = 'x64'
)
$ErrorActionPreference = 'Stop'

if ($Version -notmatch '^\d{1,3}\.\d{1,3}\.\d{1,5}$') {
    throw "Version '$Version' must be MAJOR.MINOR.PATCH (an MSI allows 255.255.65535)"
}
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Resolve-Path (Join-Path $here '..\..')
$goarch = if ($Arch -eq 'x64') { 'amd64' } else { 'arm64' }
$exe = Join-Path $server "dist\topo-server-windows-$goarch.exe"
if (-not (Test-Path $exe)) { throw "missing $exe (make windows first)" }
$conf = Join-Path $here 'topo.conf'
$out = Join-Path $server "dist\topo-server-$Version-$Arch.msi"

wix build -arch $Arch -ext WixToolset.Util.wixext `
    -d "Version=$Version" -d "Exe=$exe" -d "Conf=$conf" `
    (Join-Path $here 'topo-server.wxs') -o $out
if ($LASTEXITCODE -ne 0) { throw "wix build failed ($LASTEXITCODE)" }
Write-Output $out
