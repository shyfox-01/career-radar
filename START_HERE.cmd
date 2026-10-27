@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Career Radar needs Node.js 22 or later.
  echo Install Node.js, then double-click this file again.
  pause
  exit /b 1
)

if not exist "node_modules\pdf-parse\package.json" (
  echo First run: installing the pinned project dependencies...
  set "npm_config_cache=%~dp0.cache\npm"
  call npm ci
  if errorlevel 1 (
    echo Dependency installation failed. Check the network and try again.
    pause
    exit /b 1
  )
)

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 4317 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  start "Career Radar server - close this window to stop" /min cmd /k "cd /d ""%~dp0"" && npm start"
)

powershell -NoProfile -Command "$ready=$false; 1..30 | ForEach-Object { try { $response=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4317/api/health' -TimeoutSec 1; if ($response.StatusCode -eq 200) { $ready=$true; break } } catch {}; Start-Sleep -Milliseconds 300 }; if (-not $ready) { exit 1 }"
if errorlevel 1 (
  echo Career Radar did not start. Open the minimized server window to see the error.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:4317/"
endlocal
