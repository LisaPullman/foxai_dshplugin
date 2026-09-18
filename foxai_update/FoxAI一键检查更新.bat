@echo off
rem =============================================================
rem FoxAI 一键检查更新 — Windows 双击入口
rem 功能(三个平台入口对齐):
rem ① Node.js: 缺失时自动引导安装(winget 优先,退回 MSI 安装向导);
rem    已装但落后时自动升级(渠道感知,不可静默升级的渠道给手动指引)
rem ② 检查并自动安装/升级 8 款 AI CLI:
rem    Claude Code / Codex CLI / Gemini CLI / OpenCode / Pi / Grok CLI / DeepSeek Harness(dsh) / Herdr(brew)
rem ③ 可选装 OpenClaw / Hermes Agent:分别询问 y/n,答 y 则安装并升级,答 n 跳过
rem ④ 接管 DSH web(全局 dsh 二进制,默认 http://127.0.0.1:3080):
rem    已在运行则先 kill 进程再重启新版,未运行则直接启动。
rem    dsh 版本受兼容性 pin 管控(当前锁 0.1.1-rc.2,高于 pin 自动回退)。
rem 需要网络；除可选工具的 y/n 确认外无需确认，结束后按任意键关闭窗口。
rem 对应其他系统: macOS 用 FoxAI一键检查更新.command / Linux 用 foxai-update-linux.sh
rem =============================================================
chcp 65001 >nul
cd /d "%~dp0"

rem Node.js 引导：核心脚本跑在 node 上，node 缺失时先装好再继续
rem （winget 优先；无 winget 则查最新版下载 MSI 走安装向导，npmmirror/nodejs.org 双源）
where node >nul 2>&1
if not errorlevel 1 goto :node_ready

echo 未检测到 Node.js，开始安装…
where winget >nul 2>&1
if not errorlevel 1 (
  winget install --id OpenJS.NodeJS -e --accept-package-agreements --accept-source-agreements
  goto :node_refresh
)

rem 无 winget：PowerShell 解析 index.json 拿最新版本号，curl 下 MSI 走安装向导
set "NODE_VER="
for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "(Invoke-RestMethod 'https://npmmirror.com/mirrors/node/index.json')[0].version"`) do set "NODE_VER=%%v"
if "%NODE_VER%"=="" for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "(Invoke-RestMethod 'https://nodejs.org/dist/index.json')[0].version"`) do set "NODE_VER=%%v"
if "%NODE_VER%"=="" (
  echo 查询最新版本失败。请从 https://nodejs.org 下载 MSI 手动安装后重跑本脚本
  pause
  exit /b 1
)
set "NODE_ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "NODE_ARCH=arm64"
set "NODE_MSI=node-%NODE_VER%-%NODE_ARCH%.msi"
curl -fSL --retry 3 -o "%TEMP%\%NODE_MSI%" "https://npmmirror.com/mirrors/node/%NODE_VER%/%NODE_MSI%"
if errorlevel 1 curl -fSL --retry 3 -o "%TEMP%\%NODE_MSI%" "https://nodejs.org/dist/%NODE_VER%/%NODE_MSI%"
if errorlevel 1 (
  echo 下载 MSI 失败。请从 https://nodejs.org 手动下载安装后重跑本脚本
  pause
  exit /b 1
)
msiexec /i "%TEMP%\%NODE_MSI%"

:node_refresh
rem 安装器不改当前会话 PATH，手动补上再继续
set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 安装失败。请手动安装后重跑: https://nodejs.org
  pause
  exit /b 1
)

:node_ready

rem 可选工具确认：分别询问是否安装并升级 OpenClaw / Hermes Agent（默认 n 跳过）
set "EXTRA_ARGS="
set "ANS="
set /p ANS=是否安装并升级 OpenClaw? [Y/N]
if /i "%ANS%"=="y" set "EXTRA_ARGS=%EXTRA_ARGS% --with openclaw"
if /i "%ANS%"=="yes" set "EXTRA_ARGS=%EXTRA_ARGS% --with openclaw"
set "ANS="
set /p ANS=是否安装并升级 Hermes Agent? [Y/N]
if /i "%ANS%"=="y" set "EXTRA_ARGS=%EXTRA_ARGS% --with hermes"
if /i "%ANS%"=="yes" set "EXTRA_ARGS=%EXTRA_ARGS% --with hermes"

node scripts\update-cli-tools.js --restart-dsh-web --auto-disable-dsh-plugins --update-node%EXTRA_ARGS%
set RC=%ERRORLEVEL%

echo.
if "%RC%"=="0" (
  echo [OK] 全部处理完成，无失败项。
) else (
  echo [X] 存在失败项，请查看上方「错误详情」，或手动执行:
  echo     node scripts\update-cli-tools.js --check
)
echo.
pause
exit /b %RC%
