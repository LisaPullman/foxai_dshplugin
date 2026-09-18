#!/bin/bash
# =============================================================
# FoxAI 一键检查更新 — Linux 双击/终端入口
# 功能(三个平台入口对齐):
# ① Node.js: 缺失时自动引导安装(brew 优先,退回 tarball 装到 ~/.foxai 并写 PATH);
#    已装但落后时自动升级(渠道感知,不可静默升级的渠道给手动指引)
# ② 检查并自动安装/升级 8 款 AI CLI:
#    Claude Code / Codex CLI / Gemini CLI / OpenCode / Pi / Grok CLI / DeepSeek Harness(dsh) / Herdr(brew)
# ③ 可选装 OpenClaw / Hermes Agent:分别询问 y/n,答 y 则安装并升级,答 n 跳过
# ④ 接管 DSH web(全局 dsh 二进制,默认 http://127.0.0.1:3080):
#    已在运行则先 kill 进程再重启新版,未运行则直接启动。
#    dsh 版本受兼容性 pin 管控(当前锁 0.1.1-rc.2,高于 pin 自动回退)。
# 需要网络；除可选工具的 y/n 确认外无需确认，结束后按回车关闭。
#
# 桌面环境双击：确保本文件有可执行权限（chmod +x），
#   在文件管理器中选择「在终端中运行」。
# 对应其他系统: macOS 用 FoxAI一键检查更新.command / Windows 用 FoxAI一键检查更新.bat
#
# 注意：Linux 下 npm 全局目录若不可写（EACCES），脚本会给出
#   sudo 或用户级 prefix（npm config set prefix ~/.npm-global）两种方案。
# =============================================================

cd "$(dirname "$0")" || exit 1

# Node.js 引导：核心脚本跑在 node 上，node 缺失时先装再继续
# （brew 优先；无 brew 则从 npmmirror/nodejs.org 下 tarball 装到 ~/.foxai/ 并写 PATH）
if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js，开始安装…"
  NODE_OK=0
  if command -v brew >/dev/null 2>&1; then
    brew install node && NODE_OK=1
  fi
  if [ "$NODE_OK" != "1" ]; then
    NODE_VER=$(curl -fsSL --max-time 30 https://npmmirror.com/mirrors/node/index.json | grep -o '"version":"v[^"]*"' | head -1 | sed 's/.*"v\([^"]*\)"$/\1/')
    if [ -z "$NODE_VER" ]; then
      NODE_VER=$(curl -fsSL --max-time 30 https://nodejs.org/dist/index.json | grep -o '"version":"v[^"]*"' | head -1 | sed 's/.*"v\([^"]*\)"$/\1/')
    fi
    NODE_OS=$(uname -s); NODE_ARCH=$(uname -m)
    [ "$NODE_OS" = "Darwin" ] && NODE_OS=darwin
    [ "$NODE_OS" = "Linux" ] && NODE_OS=linux
    case "$NODE_ARCH" in
      arm64|aarch64) NODE_ARCH=arm64 ;;
      x86_64|amd64)  NODE_ARCH=x64 ;;
    esac
    NODE_TARBALL="node-v$NODE_VER-$NODE_OS-$NODE_ARCH.tar.gz"
    NODE_DIR="$HOME/.foxai/node-v$NODE_VER-$NODE_OS-$NODE_ARCH"
    if [ -n "$NODE_VER" ] && { curl -fSL --retry 3 -o "/tmp/$NODE_TARBALL" "https://npmmirror.com/mirrors/node/v$NODE_VER/$NODE_TARBALL" || curl -fSL --retry 3 -o "/tmp/$NODE_TARBALL" "https://nodejs.org/dist/v$NODE_VER/$NODE_TARBALL"; }; then
      mkdir -p "$HOME/.foxai" && tar -xzf "/tmp/$NODE_TARBALL" -C "$HOME/.foxai" && NODE_OK=1
    fi
    if [ "$NODE_OK" = "1" ]; then
      export PATH="$NODE_DIR/bin:$PATH"
      # 幂等写入登录 shell 的 PATH（macOS 用 .zprofile，Linux 用 .profile）
      NODE_PROFILE="$HOME/.zprofile"
      [ "$(uname -s)" = "Linux" ] && NODE_PROFILE="$HOME/.profile"
      grep -q 'foxai node' "$NODE_PROFILE" 2>/dev/null || \
        echo "export PATH=\"$NODE_DIR/bin:\$PATH\"  # foxai node 引导安装" >> "$NODE_PROFILE"
    fi
  fi
fi
if ! command -v node >/dev/null 2>&1; then
  echo "✘ Node.js 安装失败。请手动安装后重跑: https://nodejs.org（或先 brew install node）"
  read -r -p "按回车键关闭…" _
  exit 1
fi

# 可选工具确认：分别询问是否安装并升级 OpenClaw / Hermes Agent（默认 n 跳过）
EXTRA_ARGS=""
read -r -p "是否安装并升级 OpenClaw? [Y/N] " answer
case "$answer" in
  [yY]|[yY][eE][sS]) EXTRA_ARGS="$EXTRA_ARGS --with openclaw" ;;
esac
read -r -p "是否安装并升级 Hermes Agent? [Y/N] " answer
case "$answer" in
  [yY]|[yY][eE][sS]) EXTRA_ARGS="$EXTRA_ARGS --with hermes" ;;
esac

node scripts/update-cli-tools.js --restart-dsh-web --auto-disable-dsh-plugins --update-node $EXTRA_ARGS
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
