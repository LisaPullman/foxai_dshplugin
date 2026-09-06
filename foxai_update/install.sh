#!/bin/bash
# foxai_cli_update 安装脚本（macOS / Linux）
# 构建 dist/ 产物并给出 cordis_define 激活指引
# Windows 请使用 install.bat

set -e

cd "$(dirname "$0")"

echo "==> foxai_cli_update 安装脚本"
echo ""

# 1. 检查 Node.js
if ! command -v node &> /dev/null; then
  echo "✗ 错误：需要 Node.js (>= 18)"
  exit 1
fi
echo "✓ Node.js: $(node -v)"

echo ""
echo "==> 步骤 1：构建 Host / Client bundle（内嵌核心脚本）"
node build.js

echo ""
echo "==> 步骤 2：构造 cordis_define 入参"
node build-cordis-args.js

echo ""
echo "==> 完成！"
echo ""
echo "接下来在 DeepSeek Harness 中："
echo "  1. 把 dist/cordis-args.json 的内容作为 cordis_define 工具的入参"
echo "  2. 用返回的 pluginId 和 packageId 调用 cordis_run"
echo "  3. 首次运行会触发审批，确认后激活"
echo ""
echo "激活后，对 agent 说「检查并更新我的 AI CLI 工具」即可调用 foxai_cli_update。"
echo ""
echo "不进 DSH 也能用（开机一键）："
echo "  macOS   双击 FoxAI一键检查更新.command"
echo "  Linux   ./foxai-update-linux.sh"
echo "  Windows 双击 FoxAI一键检查更新.bat"
