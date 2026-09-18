#!/bin/bash
# =============================================================
# FoxAI 一键检查更新 — macOS 双击入口
# 检查并自动安装/升级 8 款 AI CLI:
#   Claude Code / Codex CLI / Gemini CLI / OpenCode / Pi / Grok CLI / DeepSeek Harness(dsh) / Herdr(brew)
# 另可选装 OpenClaw / Hermes Agent:运行时询问 y/n,答 y 则安装并升级,答 n 跳过。
# 并接管 DSH web(全局 dsh 二进制,默认 http://127.0.0.1:3080):
#   已在运行则先 kill 进程再重启新版,未运行则直接启动。
#   dsh 版本受兼容性 pin 管控(当前锁 0.1.1-rc.2,高于 pin 自动回退)。
# 需要已安装 Node.js 与网络；除开头一次可选确认外无需确认，结束后按回车关闭窗口。
#
# 提示：若双击被 Gatekeeper 拦截（未知开发者），
#   右键点本文件 →「打开」，或在终端执行
#   xattr -d com.apple.quarantine "FoxAI一键检查更新.command"
# 对应其他系统: Windows 用 FoxAI一键检查更新.bat / Linux 用 foxai-update-linux.sh
# =============================================================

# 双击打开时工作目录可能是 HOME，先回到脚本所在目录
cd "$(dirname "$0")" || exit 1

# 可选工具确认：是否安装并升级 OpenClaw 与 Hermes Agent（默认 n 跳过）
EXTRA_ARGS=""
read -r -p "是否安装并升级 OpenClaw 与 Hermes Agent? [y/N] " answer
case "$answer" in
  [yY]|[yY][eE][sS]) EXTRA_ARGS="--with openclaw,hermes" ;;
  *) EXTRA_ARGS="" ;;
esac

node scripts/update-cli-tools.js --restart-dsh-web --auto-disable-dsh-plugins $EXTRA_ARGS
rc=$?

echo ""
if [[ $rc -eq 0 ]]; then
  echo "✔ 全部处理完成，无失败项。"
else
  echo "✘ 存在失败项，请查看上方「错误详情」，或手动执行:"
  echo "    node scripts/update-cli-tools.js --check"
fi
echo ""

# 保持窗口，让用户看清结果
read -r -p "按回车键关闭窗口…" _
exit $rc
