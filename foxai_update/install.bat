@echo off
rem foxai_cli_update installer (Windows)
rem IMPORTANT: keep this file PURE ASCII (no Chinese/multibyte chars,
rem no em-dash). cmd re-decodes the script with the old codepage when
rem blocks re-seek the file; multibyte bytes make it land mid-line.
rem Builds dist/ bundles and prints cordis_define activation hints.
rem macOS / Linux: use install.sh
chcp 65001 >nul
cd /d "%~dp0"

echo ==^> foxai_cli_update installer
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [X] Error: Node.js ^(^>= 18^) is required
  exit /b 1
)
echo [OK] Node.js:
node -v

echo.
echo ==^> Step 1: build Host / Client bundles (core scripts embedded)
call node build.js
if errorlevel 1 exit /b 1

echo.
echo ==^> Step 2: build cordis_define arguments
call node build-cordis-args.js
if errorlevel 1 exit /b 1

echo.
echo ==^> Done!
echo.
echo Next, inside DeepSeek Harness:
echo   1. feed dist\cordis-args.json as the cordis_define tool input
echo   2. call cordis_run with the returned pluginId and packageId
echo   3. first run triggers approval - confirm to activate
echo.
echo Without DSH (one-click at boot): double-click the one-click
echo update .bat that sits next to this script in the same folder
echo (macOS: .command entry / Linux: foxai-update-linux.sh)
