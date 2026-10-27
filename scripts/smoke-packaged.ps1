param(
  [ValidateSet("unpacked", "portable")]
  [string]$Target = "unpacked"
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
# Kept under dist on the project drive, out of version control.
$SmokeBase = Join-Path $ProjectRoot "dist\smoke"
$Version = (Get-Content -LiteralPath (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json).version
$Executable = if ($Target -eq "portable") {
  Join-Path $ProjectRoot "dist\CareerRadar-Portable-$Version.exe"
} else {
  Join-Path $ProjectRoot "dist\win-unpacked\Career Radar.exe"
}
$SmokeRoot = "$SmokeBase\career-radar-smoke-data"
$StdoutPath = "$SmokeBase\career-radar-smoke.stdout.log"
$StderrPath = "$SmokeBase\career-radar-smoke.stderr.log"
$MarkerPath = "$SmokeBase\career-radar-smoke.marker.json"
$UserDataRoot = "$SmokeBase\career-radar-smoke-user-data"

if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
  throw "Packaged executable not found: $Executable"
}

New-Item -ItemType Directory -Force -Path $SmokeRoot | Out-Null
$env:CAREER_RADAR_DATA_DIR = $SmokeRoot
$env:CAREER_RADAR_SMOKE_MARKER = $MarkerPath
if (Test-Path -LiteralPath $MarkerPath -PathType Leaf) {
  Remove-Item -LiteralPath $MarkerPath -Force
}

$Process = Start-Process -FilePath $Executable -ArgumentList "--smoke-test", "--user-data-dir=$UserDataRoot" -PassThru -WindowStyle Hidden -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath
$Exited = $Process.WaitForExit(30000)
if (-not $Exited) {
  Stop-Process -Id $Process.Id -Force
  throw "Packaged smoke test timed out after 30 seconds."
}

$MarkerDeadline = [DateTime]::UtcNow.AddSeconds(30)
while (-not (Test-Path -LiteralPath $MarkerPath -PathType Leaf) -and [DateTime]::UtcNow -lt $MarkerDeadline) {
  Start-Sleep -Milliseconds 250
}

$Stdout = if (Test-Path -LiteralPath $StdoutPath) { Get-Content -LiteralPath $StdoutPath -Raw } else { "" }
$Stderr = if (Test-Path -LiteralPath $StderrPath) { Get-Content -LiteralPath $StderrPath -Raw } else { "" }
$Marker = if (Test-Path -LiteralPath $MarkerPath -PathType Leaf) { Get-Content -LiteralPath $MarkerPath -Raw } else { "" }

$ExitCode = $Process.ExitCode
if ($Marker -notmatch '"ok"\s*:\s*true') {
  throw "Packaged smoke test failed. Exit=$($Process.ExitCode) Stdout=$Stdout Stderr=$Stderr Marker=$Marker"
}

[PSCustomObject]@{
  Result = "PASS"
  ExitCode = if ($null -eq $ExitCode) { "not reported by Windows GUI process" } else { $ExitCode }
  Evidence = $Marker.Trim()
  Target = $Target
  DataRoot = $SmokeRoot
}
