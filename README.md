# foxai_dshplugin

foxai 的 DeepSeek 插件集合仓库,当前包含 [foxaippt](./foxaippt)(AI 网页 PPT 生成器)、其 MCP 版 [foxaippt_claude](./foxaippt_claude),[foxai_vigener](./foxai_vigener)(FAL AI 多模型生成),以及 [foxai-gpt-image-2](./foxai-gpt-image-2)(GPT-Image-2 工业级提示词生成 + Node.js MCP server)。

## 插件一览

| 插件 | 说明 |
| --- | --- |
| [foxaippt](./foxaippt) | 粘贴长文案 → AI(DeepSeek)流式拆解为多页 PPT,网页端全屏演示、多主题切换、导出独立 HTML |
| [foxaippt_claude](./foxaippt_claude) | foxaippt 的 MCP server:在 Claude Code 中直接调用"文案 → PPT → 独立 HTML",模型复用 Claude Code 当前 API 配置 |
| [foxai_vigener](./foxai_vigener) | FAL AI 多模型生成插件:图片/视频/音频;自定义模型注册表;**Web 响应式 + MCP 双入口**(供 Claude Code 与 DeepSeek Harness 使用) |
| [foxai_img2threejs](./foxai_img2threejs) | img2threejs 的 DSH 宿主插件(npm 持久 Plugin):把参考图 → 程序化 Three.js 模型的 Agent Skill 注册进 `ctx.skills`,`dsh plugin add` 一次安装、全會话可用;见 [README-DSH.md](./foxai_img2threejs/README-DSH.md) |
| [foxai_sd2.5](./foxai_sd2.5) | DSH 动态 Cordis 插件:把豆包 Seedance 2.5 文生视频/图生视频的需求拆成结构化合同,产物是 host bundle + cordis args,见 [docs/README.md](./foxai_sd2.5/docs/README.md) |
| [foxai-gpt-image-2](./foxai-gpt-image-2) | DSH 动态 Cordis 插件 + Node.js MCP server:把用户的自然语言需求转化为符合 GPT-Image-2 规范的工业级提示词(awesome-gpt-image-2 风格库,**26 模板 / 14 分类(含「照片转海报」) / 18 风格 / 10 场景**),零依赖、零密钥、纯前端;暴露 4 个 MCP 工具:`gpt_image2_library` / `gpt_image2_analyze` / `gpt_image2_assemble` / `gpt_image2_posterize` |
| [foxai_update](./foxai_update) | DSH 动态 Cordis 插件 + 开机一键脚本:检查并安装/升级 5 款 AI CLI(Claude Code / Codex CLI / Gemini CLI / OpenCode / Pi,npm 全局通道);agent 工具 `foxai_cli_update`(支持仅检查/子集),**跨 macOS/Linux/Windows**(核心为纯 Node 脚本 + 三系统双击入口) |
| [foxai_H3 skill](./foxai_H3%20skill) | MiniMax H3(海螺3)视频提示词导演(Claude Code skill,零依赖):朦胧文字意向 → 专业文生视频提示词;**双输出模式**(海螺官网中文版 / API 结构化英文三字段 + 分镜时间戳 + 对白系统),附图生视频多分镜连贯系统,见 [README.md](./foxai_H3%20skill/README.md) |

## foxaippt 快速开始

```bash
cd foxaippt
pnpm install     # 首次,需要 Node.js >= 18
pnpm start       # 或 node server.js
```

打开 <http://127.0.0.1:8787>(端口可用 `PORT` 环境变量覆盖)。

### 功能

- 粘贴长文案,后端调用 `deepseek-v4-pro` 拆解为多页 PPT 结构(封面 + 内容页 + 章节页 + 结束页)
- **流式生成**:后端转发 DeepSeek 的 SSE 流,前端实时显示生成进度(字数、速率、进度条)
- 全屏演示 + 键盘翻页(`←`/`→`/`Space`/`PageUp`/`PageDown`/`Home`/`End`,`F` 全屏)
- **5 套配色主题**切换(午夜蓝 / 深海青 / 落日橙 / 森林绿 / 宣纸白),记忆上次选择
- 导出**独立 HTML 文件**:内联全部 CSS/JS/内容,双击即可离线打开、翻页、换主题、全屏
- 响应式多端兼容(桌面宽屏双栏 / 手机单栏)

### API Key

后端按以下优先级自动从本机读取 DeepSeek API Key:

1. 环境变量 `DEEPSEEK_API_KEY`
2. `~/.dsh/.credentials.yaml` 中的 `DEEPSEEK_API_KEY`

### API

- `GET /api/config` — 返回模型名、base_url、是否已配置 API Key
- `POST /api/generate` — body `{ "text": "..." }`,返回 SSE 流:
  - `event: meta` 模型信息
  - `event: delta` 文本增量(实时进度)
  - `event: done` 最终 `{ deck: { title, subtitle, slides: [...] } }`
  - `event: error` 错误信息

### 技术栈

- **后端**:Node.js + Express,原生 `fetch` 调用 OpenAI 兼容协议(`base_url https://api.deepseek.com/v1`,`model deepseek-v4-pro`,`stream:true`),以 SSE 逐块转发
- **前端**:原生 HTML/CSS/JS,无构建步骤;导出文件内联全部资源,单文件自包含

更多细节见 [foxaippt/README.md](./foxaippt/README.md)。

## foxai-gpt-image-2 快速开始

```bash
cd foxai-gpt-image-2
npm install         # 首次,需要 Node.js >= 18
npm run build       # 重新生成 plugin/host.bundled.js + client.bundled.js
npm test            # 跑 node:test,8 个用例覆盖 4 个工具
node claude/mcp-server.mjs   # 以 stdio JSON-RPC 暴露给 MCP 客户端
```

### MCP 工具

| 工具 | 输入 | 输出 | 说明 |
| --- | --- | --- | --- |
| `gpt_image2_library` | `{ lang: 'zh' \| 'en' }` | `{ categories, styles, scenes, templates }` | 样式库快照,14 类 / 18 风格 / 10 场景 / 26 模板 |
| `gpt_image2_analyze` | `{ userInput, lang }` | `{ tags, styleIds, sceneIds, candidates, fallback }` | 同义词扩展 + 模板打分,返回 Top-4 候选 |
| `gpt_image2_assemble` | `{ userInput, templateId?, lang, slots? }` | `{ prompt, template, guidance, pitfalls, blocks }` | 按模板 + 槽位组装最终 GPT-Image-2 提示词 |
| `gpt_image2_posterize` | `{ imageHint, styleHint?, templateId?, lang?, slots? }` | `{ prompt, template, guidance, pitfalls, blocks }` | 照片转海报,**仅在 cat-posterize 子集打分**,4 个内置海报模板(古风 / 极简旅行 / 杂志封面 / 现代粗体) |

### 槽位 (`slots`)

`assemble` 支持 `{ subject, aspect, tone, text }`;`posterize` 支持 `{ titleText, subtitleText, captionText, englishText, palette, aspect }`。

### MCP 测试状态

最近一次全量回归(2026-09-01):

- ✅ `gpt_image2_library` (zh) — 14 categories / 19 styles / 10 scenes / 26 templates
- ✅ `gpt_image2_analyze` (zh) — 3D 收藏玩具/宇航员猫咪 → top-1 `3d-collectible-toy` (score 11)
- ✅ `gpt_image2_analyze` (en) — 古镇飞檐/紫藤花海报化 → top-1 `posterize-travel-minimal` (score 37)
- ✅ `gpt_image2_analyze` (zh) — 模糊输入 `做一个图` → fallback `illustration-art-style`
- ✅ `gpt_image2_assemble` (zh, 指定 templateId) — 7 个结构化 blocks,主体/aspect/tone 全流入
- ✅ `gpt_image2_assemble` (en, 指定 templateId) — 英文版 7 个 blocks
- ✅ `gpt_image2_posterize` (zh, 自动挑选) — 选 `posterize-travel-minimal`,4 个文本 + palette + aspect 全流入
- ✅ `gpt_image2_posterize` (en, 指定 templateId) — 选 `posterize-classical-chinese`,英文版 9 blocks
- ✅ `node --test scripts/build-plugin.test.mjs` — 8/8 通过

更多细节见 [foxai-gpt-image-2/README.md](./foxai-gpt-image-2/README.md)。

## foxai_update 快速开始

```bash
cd foxai_update
node scripts/update-cli-tools.js --check   # 只看报告:5 款 AI CLI 的当前/最新版本
node scripts/update-cli-tools.js           # 执行:缺失的安装,落后的升级到最新
./install.sh                               # 构建 DSH 插件产物 dist/cordis-args.json(Windows 用 install.bat)
```

- 管辖:Claude Code / Codex CLI / Gemini CLI / OpenCode / Pi(npm 全局通道,识别 brew 等外部渠道并跳过)
- 开机一键:macOS 双击 `FoxAI一键检查更新.command`,Windows 双击 `FoxAI一键检查更新.bat`,Linux `./foxai-update-linux.sh`
- DSH 激活:`cordis_define` 贴入 `dist/cordis-args.json` → `cordis_run` → 审批;之后对 agent 说「检查并更新我的 AI CLI 工具」即可

更多细节见 [foxai_update/README.md](./foxai_update/README.md)。
