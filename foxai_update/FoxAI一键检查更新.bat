@echo off
rem ============================================================
rem FoxAI one-click update - Windows entry (double-click)
rem IMPORTANT: keep this file PURE ASCII (no Chinese/multibyte
rem chars, no em-dash). cmd re-decodes the script with the old
rem codepage when goto/for re-seek the file; multibyte bytes in
rem comment/echo lines make it land mid-line and execute garbage.
rem Chinese UI lives in scripts\update-cli-tools.js (UTF-8) -
rem that is why chcp 65001 below must run before invoking node.
rem Workflow (aligned with macOS .command / Linux .sh entries):
rem  1) Node.js: bootstrap-install if missing (winget first,
rem     fallback: download MSI via curl); upgrade if outdated
rem  2) check/install/upgrade 7 AI CLIs: Claude Code / Codex /
rem     Gemini CLI / OpenCode / Pi / Grok CLI / Herdr
rem  3) optional OpenClaw / Hermes Agent (y/n prompts)
rem macOS: the .command entry / Linux: foxai-update-linux.sh
rem ============================================================
chcp 65001 >nul
cd /d "%~dp0"

rem Node.js bootstrap: the core script runs on node
where node >nul 2>&1
if not errorlevel 1 goto :node_ready

echo Node.js not found - installing...
where winget >nul 2>&1
if not errorlevel 1 (
  winget install --id OpenJS.NodeJS -e --accept-package-agreements --accept-source-agreements
  goto :node_refresh
)

rem No winget: resolve latest version via PowerShell, download MSI with curl
set "NODE_VER="
for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "(Invoke-RestMethod 'https://npmmirror.com/mirrors/node/index.json')[0].version"`) do set "NODE_VER=%%v"
if "%NODE_VER%"=="" for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "(Invoke-RestMethod 'https://nodejs.org/dist/index.json')[0].version"`) do set "NODE_VER=%%v"
if "%NODE_VER%"=="" (
  echo Failed to query latest version. Please install Node.js manually from https://nodejs.org then re-run this script
  pause
  exit /b 1
)
set "NODE_ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "NODE_ARCH=arm64"
set "NODE_MSI=node-%NODE_VER%-%NODE_ARCH%.msi"
curl -fSL --retry 3 -o "%TEMP%\%NODE_MSI%" "https://npmmirror.com/mirrors/node/%NODE_VER%/%NODE_MSI%"
if errorlevel 1 curl -fSL --retry 3 -o "%TEMP%\%NODE_MSI%" "https://nodejs.org/dist/%NODE_VER%/%NODE_MSI%"
if errorlevel 1 (
  echo Failed to download MSI. Please download Node.js manually from https://nodejs.org then re-run this script
  pause
  exit /b 1
)
msiexec /i "%TEMP%\%NODE_MSI%"

:node_refresh
rem Installers do not update PATH of the current session - prepend manually
set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js installation failed. Please install manually from https://nodejs.org then re-run
  pause
  exit /b 1
)

:node_ready

rem Optional tools: ask y/n for OpenClaw / Hermes Agent (default n = skip)
set "EXTRA_ARGS="
set "ANS="
set /p ANS=Install and upgrade OpenClaw? [Y/N]
if /i "%ANS%"=="y" set "EXTRA_ARGS=%EXTRA_ARGS% --with openclaw"
if /i "%ANS%"=="yes" set "EXTRA_ARGS=%EXTRA_ARGS% --with openclaw"
set "ANS="
set /p ANS=Install and upgrade Hermes Agent? [Y/N]
if /i "%ANS%"=="y" set "EXTRA_ARGS=%EXTRA_ARGS% --with hermes"
if /i "%ANS%"=="yes" set "EXTRA_ARGS=%EXTRA_ARGS% --with hermes"

node scripts\update-cli-tools.js --update-node%EXTRA_ARGS%
set RC=%ERRORLEVEL%

echo.
if "%RC%"=="0" (
  echo [OK] All done, no failures.
) else (
  echo [X] Some items failed - see details above, or run manually:
  echo     node scripts\update-cli-tools.js --check
)
echo.
pause
exit /b %RC%
