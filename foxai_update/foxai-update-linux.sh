#!/bin/bash
# =============================================================
# FoxAI 一键检查更新 — Linux 双击/终端入口
# 检查并自动安装/升级 7 款 AI CLI:
#   Claude Code / Codex CLI / Gemini CLI / OpenCode / Pi / Grok CLI / DeepSeek Harness(dsh)
# 并接管 DSH web(全局 dsh 二进制,默认 http://127.0.0.1:3080):
#   已在运行则先 kill 进程再重启新版,未运行则直接启动。
#   dsh 版本受兼容性 pin 管控(当前锁 0.1.1-rc.2,高于 pin 自动回退)。
# 需要已安装 Node.js 与网络；全程无需确认，结束后按回车关闭。
#
# 桌面环境双击：确保本文件有可执行权限（chmod +x），
#   在文件管理器中选择「在终端中运行」。
# 对应其他系统: macOS 用 FoxAI一键检查更新.command / Windows 用 FoxAI一键检查更新.bat
#
# 注意：Linux 下 npm 全局目录若不可写（EACCES），脚本会给出
#   sudo 或用户级 prefix（npm config set prefix ~/.npm-global）两种方案。
# =============================================================

cd "$(dirname "$0")" || exit 1

node scripts/update-cli-tools.js --restart-dsh-web
rc=$?

echo ""
if [[ $rc -eq 0 ]]; then
  echo "✔ 全部处理完成，无失败项。"
else
  echo "✘ 存在失败项，请查看上方「错误详情」，或手动执行:"
  echo "    node scripts/update-cli-tools.js --check"
fi
echo ""

read -r -p "按回车键关闭…" _
exit $rc
