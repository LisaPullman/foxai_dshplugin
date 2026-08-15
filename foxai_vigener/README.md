# foxai_vigener · FAL AI 多模型生成插件

通过 [FAL AI](https://fal.ai) 平台生成**图片、视频、音频**等内容的 foxai 插件。
**Web 响应式界面 + MCP server 双入口**,同时支持:

- **DeepSeek Harness** (DSH) — 通过 DSH 内置的 `dsh-mcp-client` 桥接入
- **Claude Code** — 直接通过 `.mcp.json` 注册
- **浏览器手动使用** — `http://127.0.0.1:8788`,响应式(桌面双栏 / 移动单栏)

模型来源全部是 fal 端点,可任意扩展(图片/视频/音频/其他);默认内置 7 个常用端点。

## 快速开始

```bash
cd foxai_vigener
npm install
cp .env.example .env       # 然后编辑 .env 填入 FAL_KEY
npm start                  # 启动 Web:http://127.0.0.1:8788
npm run mcp                # 或以 MCP server(stdio)模式启动
npm test                   # 跑 MCP + API 集成测试
```

## 配置 `.env`

```
FAL_KEY=your-fal-key-here
```

从 <https://fal.ai/dashboard/keys> 申请 Key。`.env` 不会入库。

## 预设模型(`models.json`)

| 类型 | 模型 id | 用途 |
| --- | --- | --- |
| 🖼 图片 | `fal-ai/nano-banana-2` ★默认 | 文生图,Google Gemini 3.1 Flash Image |
| 🖼 图片 | `fal-ai/nano-banana-2/edit` | 图片编辑,最多 14 张参考图 |
| 🖼 图片 | `openai/gpt-image-2` | 文生图,OpenAI 新一代图像模型 |
| 🖼 图片 | `openai/gpt-image-2/edit` | 图片编辑,支持 mask |
| 🎬 视频 | `fal-ai/kling-video/v3/standard/text-to-video` ★默认 | 文生视频,可灵 V3 标准版,3~15s |
| 🎬 视频 | `fal-ai/kling-video/v3/standard/image-to-video` | 图生视频,以参考图为首帧 |
| 🔊 音频 | `fal-ai/gemini-3.1-flash-tts` ★默认 | 文本转语音,支持表现力标签 |

### 模型注册表 schema(`models.json` / `models.local.json`)

```jsonc
{
  "id": "fal-ai/<your-endpoint>",
  "label": "显示名",
  "type": "image | video | audio | other",
  "kind": "text-to-image | image-edit | text-to-video | image-to-video | tts | ...",
  "isDefault": false,
  "promptParam": "prompt",                        // fal 入参的提示词字段名
  "referenceImages": { "param": "image_urls", "multiple": true },  // null 表示不支持
  "aspectRatio": { "param": "aspect_ratio", "map": { "16:9": "landscape_16_9" } },
  "numImages": { "param": "num_images" },
  "duration": { "param": "duration", "default": 5, "min": 3, "max": 15 },
  "notes": "可选说明"
}
```

#### 自定义任意 fal 模型(支持 fal 全部端点)

把任意 fal 端点加到 **`models.local.json`**(与 `models.json` 同结构,gitignore),同 `id` 覆盖预设。无需改代码:

```json
{
  "models": [
    {
      "id": "your-org/some-other-model",
      "label": "我的自定义模型",
      "type": "image",
      "kind": "text-to-image",
      "isDefault": false,
      "promptParam": "prompt",
      "referenceImages": null,
      "aspectRatio": { "param": "aspect_ratio" },
      "numImages": { "param": "num_images" },
      "duration": null,
      "notes": "用于自定义场景"
    }
  ]
}
```

最少只需 `id / label / type` 三个字段,其他未声明的参数会通过工具的 `extraInput` 透传。

也可以直接在 **Web 界面**添加:打开 <http://127.0.0.1:8788> → 点击「＋ 添加 fal 模型」按钮 → 填写端点 ID、显示名称、类型、用途等 → 保存。模型立即出现在生成下拉框中。删除也是同样的入口。

## MCP 工具(stdio,供 DSH / Claude Code 调用)

启动 `node index.js` 后暴露三个工具:

| 工具 | 作用 |
| --- | --- |
| `check_config` | 检查 FAL_KEY、注册表统计、文件夹路径 |
| `list_models` | 列出注册表(分组 + 默认标记) |
| `generate` | `{ model, prompt, referenceImages?, aspectRatio?, numImages?, duration?, extraInput? }` → 调 fal → 下载产物到「完成档」 |

### Claude Code 接入

项目级(随仓库提交,协作者克隆即用):

```bash
claude mcp add foxai-vigener --scope project -- node "$PWD/foxai_vigener/index.js"
```

全局(本机所有项目可用):

```bash
claude mcp add foxai-vigener --scope user -- node /Users/foxai/Desktop/dsh_plugin/foxai_vigener/index.js
```

启动 Claude Code 后即可:

> 用 foxai-vigener 生成一张 16:9 的「一只橘猫在阳光下的木桌上」的图片

### DeepSeek Harness 接入

DSH 内置 `dsh-mcp-client` 桥,支持 stdio MCP。在 `~/.dsh/profiles/web/cordis.patch.yml` 追加(具体字段以 `dsh-mcp-client` 源码/`--dump-config` 实际 schema 为准):

```yaml
plugins:
  - name: mcp-client
    options:
      servers:
        - name: foxai-vigener
          transport: stdio
          command: node
          args:
            - /Users/foxai/Desktop/dsh_plugin/foxai_vigener/index.js
```

验证配置生效:

```bash
npx -y @deepseek-ai/dsh --profile web --dump-config
```

## Web 界面

`npm start` → <http://127.0.0.1:8788>

- 左栏:模型选择、提示词、参考图(可上传)、宽高比、张数、时长、高级参数
- 右栏:完成档画廊(图片/视频/音频预览,点击放大)
- SSE 实时显示队列状态 + 进度日志
- 响应式:≥900px 双栏;<900px 单栏;手机可用

### REST API 概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/config` | FAL_KEY 状态、注册表统计、文件夹路径 |
| GET | `/api/models` | 模型分组 + 默认标记 |
| GET | `/api/custom-models` | 「自定义模型」清单(`models.local.json`) |
| POST | `/api/custom-models` | 添加/覆盖自定义模型(`{ model: {...} }`) |
| DELETE | `/api/custom-models/:id` | 删除自定义模型 |
| GET | `/api/references` | 「参考图」清单 |
| POST | `/api/references` | 上传参考图(`multipart/form-data`,字段 `file`) |
| POST | `/api/generate` | 生成(**SSE**:`event: progress/log/done/error`) |
| GET | `/api/outputs` | 「完成档」清单(按时间倒序) |
| GET | `/outputs/<name>` | 静态托管完成档 |

## 文件夹约定

- `参考图/` —— 存放用户提供的参考图(`.gitkeep` 占位,实际文件不入库)
- `完成档/` —— 生成产物落盘目录,命名规则:
  `{模型id去斜杠}-{YYYYMMDD}-{HHmm}[-{序号}].{ext}`
  例:`fal-ai-nano-banana-2-20260815-2030.png`

## 目录结构

```
foxai_vigener/
├── package.json
├── .env.example         # FAL_KEY 模板
├── .env                 # 用户自填(不入库)
├── .gitignore
├── models.json          # 预设注册表(随仓库分发)
├── models.local.json    # 用户自定义(可选,gitignore)
├── index.js             # MCP server(stdio)
├── server.js            # Express Web 应用
├── lib/
│   ├── env.js           # .env 加载、路径常量
│   ├── registry.js      # 注册表合并 + 参数归一化
│   ├── fal.js           # FAL 客户端封装(subscribe + storage.upload)
│   └── generate.js      # 统一生成流程
├── public/              # 响应式前端
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── 参考图/              # 参考图(可空)
├── 完成档/              # 产物(可空)
├── test/
│   ├── client.mjs       # MCP 集成测试
│   └── api.mjs          # REST API 集成测试
└── README.md
```

## 测试

```bash
npm test   # 跑两个集成测试
```

- `test/client.mjs`:MCP listTools / check_config / list_models / generate(无 key 时期望清晰错误)
- `test/api.mjs`:启动 server.js 后调各路由,验证响应 schema + 错误路径

## 许可

MIT