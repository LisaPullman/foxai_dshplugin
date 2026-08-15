# foxaippt_claude · foxaippt 的 MCP server

把 [foxaippt](../foxaippt) 的"长文案 → 多页 PPT → 独立 HTML"能力封装为 MCP(stdio)工具,供 Claude Code 等 MCP 客户端直接调用。

**模型说明**:不依赖 DeepSeek,直接复用 Claude Code 本机的 API 配置(Anthropic 兼容协议),即当前 Claude Code 正在调用的模型。从环境变量读取,无需单独配置 key:

| 环境变量 | 作用 |
| --- | --- |
| `ANTHROPIC_BASE_URL` | API 端点(如 `https://open.bigmodel.cn/api/anthropic`) |
| `ANTHROPIC_AUTH_TOKEN`(或 `ANTHROPIC_API_KEY`) | 认证 Token |
| `ANTHROPIC_MODEL` | 模型名(自动去掉 `[1M]` 之类的标签;亦可用 `FOXAIPPT_MODEL` 覆盖) |

## 工具(3 个)

| 工具 | 说明 |
| --- | --- |
| `check_config` | 检查模型 / base_url / API Key 是否就绪 |
| `generate_ppt` | 长文案 → PPT 结构 JSON(`{title, subtitle, slides:[{title, subtitle, bullets, notes}]}`) |
| `export_ppt_html` | deck(或直接给文案)→ 写出独立 HTML 演示文件,5 套主题可选 |

导出的 HTML 与 foxaippt 网页版完全一致:内联全部 CSS/JS/内容,双击即可离线打开,`←`/`→`/`Space` 翻页、`F` 全屏、🎨 循环切换主题。

## 在 Claude Code 中注册

```bash
claude mcp add foxaippt --scope project -- node /absolute/path/to/foxaippt_claude/index.js
```

重启 Claude Code 后即可使用,例如直接说:"把这段文案做成 PPT,导出到 ~/Desktop/demo.html"。

## 本地测试

```bash
cd foxaippt_claude
npm install
npm test        # 启动 server 并依次调用 listTools / check_config / generate_ppt / export_ppt_html
```

测试产物在 `output/` 目录,可直接用浏览器打开验证。

## 目录结构

```
index.js              # MCP server(stdio):注册 3 个工具
lib/llm.js            # Anthropic 兼容协议调用(复用 Claude Code 的 ANTHROPIC_* 配置)
lib/export-html.js    # 独立 HTML 渲染/导出(模板与 foxaippt 网页版一致)
test/client.mjs       # 集成测试客户端
```
