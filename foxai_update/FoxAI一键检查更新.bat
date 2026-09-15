@echo off
rem =============================================================
rem FoxAI 一键检查更新 — Windows 双击入口
rem 检查并自动安装/升级 7 款 AI CLI:
rem   Claude Code / Codex CLI / Gemini CLI / OpenCode / Pi / Grok CLI / DeepSeek Harness(dsh)
rem 并接管 DSH web(全局 dsh 二进制,默认 http://127.0.0.1:3080):
rem   已在运行则先 kill 进程再重启新版,未运行则直接启动。
rem   dsh 版本受兼容性 pin 管控(当前锁 0.1.1-rc.2,高于 pin 自动回退)。
rem 需要已安装 Node.js 与网络；全程无需确认，结束后按任意键关闭窗口。
rem 对应其他系统: macOS 用 FoxAI一键检查更新.command / Linux 用 foxai-update-linux.sh
rem =============================================================
chcp 65001 >nul
cd /d "%~dp0"

node scripts\update-cli-tools.js --restart-dsh-web --auto-disable-dsh-plugins
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
