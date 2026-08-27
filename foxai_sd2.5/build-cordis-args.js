// 构造 cordis_define 的输入参数，写成 JSON 文件
// 注意：cordis_define 接受 JSON 参数，code.host 和 code.client 是字符串
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const hostCode = readFileSync(resolve(__dirname, 'dist/host-bundle.js'), 'utf8');
const clientCode = readFileSync(resolve(__dirname, 'dist/client-bundle.js'), 'utf8');

const args = {
  plugin: { kind: 'new', idPrefix: 'foxsd' },
  name: 'foxai_sd25_video',
  purpose: 'Seedance 2.5 视频提示词生成器：通过对话或文件上传接收用户需求，生成符合 SD2.5 标准的提示词文本，可直接交给 Seedance 2.5 本生视频生成。支持 12 种官方契约模板与 Context 7 实时文档查询。',
  code: {
    host: hostCode,
    client: clientCode,
  },
};

writeFileSync(resolve(__dirname, 'dist/cordis-args.json'), JSON.stringify(args));
console.log('✓ cordis-args.json 已生成');
console.log('  total size:', JSON.stringify(args).length, 'chars');
