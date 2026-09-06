@echo off
rem foxai_cli_update 安装脚本（Windows）
rem 构建 dist/ 产物并给出 cordis_define 激活指引
rem macOS / Linux 请使用 install.sh
chcp 65001 >nul
cd /d "%~dp0"

echo ==^> foxai_cli_update 安装脚本
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [X] 错误：需要 Node.js ^(^>= 18^)
  exit /b 1
)
echo [OK] Node.js:
node -v

echo.
echo ==^> 步骤 1：构建 Host / Client bundle（内嵌核心脚本）
call node build.js
if errorlevel 1 exit /b 1

echo.
echo ==^> 步骤 2：构造 cordis_define 入参
call node build-cordis-args.js
if errorlevel 1 exit /b 1

echo.
echo ==^> 完成！
echo.
echo 接下来在 DeepSeek Harness 中：
echo   1. 把 dist\cordis-args.json 的内容作为 cordis_define 工具的入参
echo   2. 用返回的 pluginId 和 packageId 调用 cordis_run
echo   3. 首次运行会触发审批，确认后激活
echo.
echo 不进 DSH 也能用（开机一键）：双击 FoxAI一键检查更新.bat
echo （macOS 用 FoxAI一键检查更新.command / Linux 用 foxai-update-linux.sh）
