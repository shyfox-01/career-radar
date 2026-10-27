$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
# Kept under dist on the project drive, out of version control.
$SmokeBase = Join-Path $ProjectRoot "dist\smoke"
$Version = (Get-Content -LiteralPath (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json).version
$Installer = Join-Path $ProjectRoot "dist\CareerRadar-Setup-$Version.exe"
$InstallRoot = "$SmokeBase\career-radar-install-smoke"
$DataRoot = "$SmokeBase\career-radar-installer-smoke-data"
$MarkerPath = "$SmokeBase\career-radar-installer-smoke.marker.json"
$UserDataRoot = "$SmokeBase\career-radar-installer-smoke-user-data"

if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) {
  throw "Installer not found: $Installer"
}
if (Test-Path -LiteralPath $InstallRoot) {
  throw "Refusing to overwrite an existing smoke-test install directory: $InstallRoot"
}
if (Test-Path -LiteralPath $MarkerPath -PathType Leaf) {
  Remove-Item -LiteralPath $MarkerPath -Force
}

$InstallProcess = Start-Process -FilePath $Installer -ArgumentList "/S", "/D=$InstallRoot" -PassThru -Wait -WindowStyle Hidden
if ($InstallProcess.ExitCode -ne 0) {
  throw "Installer exited with code $($InstallProcess.ExitCode)."
}

$Application = Join-Path $InstallRoot "Career Radar.exe"
$Uninstaller = Join-Path $InstallRoot "Uninstall Career Radar.exe"
if (-not (Test-Path -LiteralPath $Application -PathType Leaf)) {
  throw "Installed application was not found: $Application"
}
if (-not (Test-Path -LiteralPath $Uninstaller -PathType Leaf)) {
  throw "Uninstaller was not found: $Uninstaller"
}

$env:CAREER_RADAR_DATA_DIR = $DataRoot
$env:CAREER_RADAR_SMOKE_MARKER = $MarkerPath
$AppProcess = Start-Process -FilePath $Application -ArgumentList "--smoke-test", "--user-data-dir=$UserDataRoot" -PassThru -WindowStyle Hidden
$MarkerDeadline = [DateTime]::UtcNow.AddSeconds(30)
while (-not (Test-Path -LiteralPath $MarkerPath -PathType Leaf) -and [DateTime]::UtcNow -lt $MarkerDeadline) {
  Start-Sleep -Milliseconds 250
}
if (-not (Test-Path -LiteralPath $MarkerPath -PathType Leaf)) {
  if (-not $AppProcess.HasExited) { Stop-Process -Id $AppProcess.Id -Force }
  throw "Installed application did not produce its smoke-test marker."
}

$Evidence = Get-Content -LiteralPath $MarkerPath -Raw
if ($Evidence -notmatch '"ok"\s*:\s*true') {
  throw "Installed application returned invalid smoke-test evidence: $Evidence"
}

if (-not $AppProcess.WaitForExit(10000)) {
  Stop-Process -Id $AppProcess.Id -Force
  throw "Installed application produced evidence but did not exit within 10 seconds."
}

$UninstallProcess = Start-Process -FilePath $Uninstaller -ArgumentList "/S" -PassThru -Wait -WindowStyle Hidden
if ($UninstallProcess.ExitCode -ne 0) {
  throw "Uninstaller exited with code $($UninstallProcess.ExitCode)."
}

$RemovalDeadline = [DateTime]::UtcNow.AddSeconds(20)
while ((Test-Path -LiteralPath $Application -PathType Leaf) -and [DateTime]::UtcNow -lt $RemovalDeadline) {
  Start-Sleep -Milliseconds 250
}
if (Test-Path -LiteralPath $Application -PathType Leaf) {
  throw "The installed application still exists after uninstall: $Application"
}

[PSCustomObject]@{
  Result = "PASS"
  InstalledTo = $InstallRoot
  Launched = $true
  Uninstalled = $true
  Evidence = $Evidence.Trim()
}
