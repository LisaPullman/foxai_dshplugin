#!/bin/bash
# foxai_sd25_video 安装脚本
# 生成 cordis_define 所需的入参 JSON 文件

set -e

cd "$(dirname "$0")"

echo "==> foxai_sd25_video 安装脚本"
echo ""

# 1. 检查 Node.js
if ! command -v node &> /dev/null; then
  echo "✗ 错误：需要 Node.js (>= 18)"
  exit 1
fi

NODE_VERSION=$(node -v)
echo "✓ Node.js: $NODE_VERSION"

# 2. 创建精简源码目录
mkdir -p src/min

echo ""
echo "==> 步骤 1：精简源代码（去除注释与多余空白）"
node -e "
const fs = require('fs');
const path = require('path');

function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^(\s*)\/\/.*$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

const files = ['contracts.js', 'generator.js', 'validator.js', 'context7.js'];
for (const f of files) {
  const src = fs.readFileSync(path.join('src', f), 'utf8');
  fs.writeFileSync(path.join('src/min', f), strip(src));
  console.log('  ✓ src/' + f + ' -> src/min/' + f + ' (' + src.length + ' -> ' + strip(src).length + ')');
}
"

echo ""
echo "==> 步骤 2：构建 Host / Client bundle"
node build.js

echo ""
echo "==> 步骤 3：构造 cordis_define 入参"
node build-cordis-args.js

echo ""
echo "==> 完成！"
echo ""
echo "接下来在 DeepSeek Harness 中："
echo "  1. 复制 dist/cordis-args.json 中的内容作为 cordis_define 工具的入参"
echo "  2. 用返回的 pluginId 和 packageId 调用 cordis_run"
echo "  3. 首次运行会触发审批，确认后激活"
echo ""
echo "详细文档请参考："
echo "  - README.md（项目总览）"
echo "  - docs/seedance-2.5-contracts.md（契约规范参考）"
echo "  - claude/SKILL.md（Claude 兼容使用）"
