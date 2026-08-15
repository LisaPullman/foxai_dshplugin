# foxai_dshplugin

foxai 的 DeepSeek 插件集合仓库,当前包含 [foxaippt](./foxaippt)(AI 网页 PPT 生成器)及其 MCP 版 [foxaippt_claude](./foxaippt_claude)。

## 插件一览

| 插件 | 说明 |
| --- | --- |
| [foxaippt](./foxaippt) | 粘贴长文案 → AI(DeepSeek)流式拆解为多页 PPT,网页端全屏演示、多主题切换、导出独立 HTML |
| [foxaippt_claude](./foxaippt_claude) | foxaippt 的 MCP server:在 Claude Code 中直接调用"文案 → PPT → 独立 HTML",模型复用 Claude Code 当前 API 配置 |

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
