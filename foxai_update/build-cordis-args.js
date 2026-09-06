// 构造 cordis_define 的输入参数，写成 JSON 文件
// 注意：cordis_define 接受 JSON 参数，code.host 和 code.client 是字符串
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const hostCode = readFileSync(resolve(__dirname, 'dist/host-bundle.js'), 'utf8');
const clientCode = readFileSync(resolve(__dirname, 'dist/client-bundle.js'), 'utf8');

const args = {
  plugin: { kind: 'new', idPrefix: 'foxup' },
  name: 'foxai_cli_update',
  purpose:
    '检查并安装/升级 6 款 AI CLI 编码工具（Claude Code、Codex CLI、Gemini CLI、OpenCode、Pi、DeepSeek Harness）：' +
    '未安装的自动 npm 全局安装，已安装的升级到最新版；支持仅检查模式与指定子集；' +
    '识别 brew 等外部渠道并跳过；执行更新时接管 DSH web（npx @deepseek-ai/dsh web，默认 127.0.0.1:3080）——' +
    '未运行则启动，可选 kill 旧进程后重启；跨 macOS/Linux/Windows。核心脚本同时可作为开机一键脚本独立运行。',
  code: {
    host: hostCode,
    client: clientCode,
  },
};

writeFileSync(resolve(__dirname, 'dist/cordis-args.json'), JSON.stringify(args));
console.log('✓ cordis-args.json 已生成');
console.log('  total size:', JSON.stringify(args).length, 'chars');
