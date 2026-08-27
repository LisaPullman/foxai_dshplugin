# foxai_sd25_video — Seedance 2.5 视频提示词生成插件

> FoxAI 出品的 Seedance 2.5（SD2.5 本生视频）提示词生成插件
> 通过对话或文件上传接收需求 → 自动生成符合 SD2.5 标准的中文提示词文本
> 可在 **DeepSeek Harness** 与 **Claude** 中使用

## 功能特性

- **12 种官方契约模板**：标准生成（4-30s）、压缩版（4-15s）、复杂 30 秒、超长视频（30-180s）、视频延长、智能编辑、创意迁移、语音对白、绿幕合成、白模渲染、无缝转场、多格分镜
- **Context 7 实时文档查询**：可选调用 Context 7 MCP 拉取最新 Seedance 2.5 文档；不可用时自动回退到嵌入式契约库
- **可视化提示词构建器**：在 DeepSeek Harness 内通过 `tool.view.cordis` 槽位渲染的交互式表单
- **校验器**：自动检测泛化美化词（"震撼、极致、8K"等）、缺失结构段落、时间轴不连续等问题
- **Claude 兼容**：提供 Claude Skill 文档（`claude/SKILL.md`）与可选 MCP 服务器（`claude/mcp-server.py`）

## 架构

```
foxai_sd2.5/
├── src/                              # 核心源代码（ES Module）
│   ├── contracts.js                  # 12 种契约模板（数据）
│   ├── generator.js                  # 提示词生成器
│   ├── validator.js                  # 校验器
│   ├── context7.js                   # Context 7 HTTP API 客户端
│   └── min/                          # 压缩版（供 build.js 使用）
├── dist/                             # 构建产物（自动生成）
│   ├── host-bundle.js                # Host 半边代码
│   ├── client-bundle.js              # Client 半边代码
│   └── cordis-args.json              # cordis_define 入参
├── claude/                           # Claude 兼容文件
│   ├── SKILL.md                      # Claude Skill 文档
│   └── mcp-server.py                 # MCP 服务器（可选）
├── docs/                             # 文档
├── test/                             # 测试代码
├── build.js                          # 构建脚本
├── build-payload.js                  # 构建 cordis_define 入参
├── build-cordis-args.js              # 构造入参 JSON
└── strip-comments.js                 # 注释精简工具
```

## 在 DeepSeek Harness 中使用

### 1. 构建

```bash
cd foxai_sd2.5
node build.js              # 生成 dist/host-bundle.js 和 dist/client-bundle.js
node build-cordis-args.js  # 生成 dist/cordis-args.json
```

### 2. 定义插件

通过 AI 工具调用 `cordis_define`，参数为 `dist/cordis-args.json` 中的内容：

```json
{
  "plugin": { "kind": "new", "idPrefix": "foxsd" },
  "name": "foxai_sd25_video",
  "purpose": "Seedance 2.5 视频提示词生成器：...",
  "code": {
    "host": "<dist/host-bundle.js 内容>",
    "client": "<dist/client-bundle.js 内容>"
  }
}
```

返回的 `pluginId` 和 `packageId` 立即调用：

```
cordis_run(pluginId=..., packageId=..., mode="run")
```

首次运行会触发**审批提示**（`awaiting-approval`），在 DeepSeek Harness Web GUI 中确认即可激活。

### 3. 通过对话使用

激活后，Agent 会自动获得以下 3 个工具：

| 工具名 | 用途 |
| --- | --- |
| `seedance25_specs` | 查询 Seedance 2.5 提示词契约规范（支持 Context 7 实时） |
| `seedance25_generate` | 把结构化输入转换为标准提示词文本 |
| `seedance25_validate` | 校验提示词文本是否符合标准 |

**对话示例**：

> 用户：我想做一个 10 秒的浪漫短片，一位 25 岁东亚女性在雨后的东京街头，撑伞走过霓虹招牌。

Agent 会自动调用 `seedance25_specs(contract_id="standard")` 获取契约，然后用 `seedance25_generate` 生成符合标准的提示词：

```
【素材说明】
@图片1用于身份、服装、场景、首帧。

【一句话概述】
一位25岁的东亚女性在雨后的东京街头，浪漫短片，35mm胶片质感。

【时间轴】
0-5秒：女主撑伞走过霓虹招牌，脚步缓慢。
5-10秒：她停步，转身面向镜头，雨水从伞尖滴落，微笑。

【全局补充】
保持服装、面孔与光影一致性。不要硬切、字幕、背景音乐。
```

### 4. 通过可视化界面使用

激活后，`cordis_run` 卡片中会出现可视化提示词构建器：
- 选择契约（12 种之一）
- 填写结构化表单（主体、动作、镜头、光线、风格、声音、时间轴等）
- 一键生成、复制、校验

## 在 Claude 中使用

### 方案 A：Claude Skill（推荐）

1. 复制 `claude/SKILL.md` 的内容
2. 在 Claude 中粘贴或上传该 Skill 文件
3. 直接对话，Claude 会自动按 Seedance 2.5 标准生成提示词

### 方案 B：MCP 服务器

1. 安装依赖：`pip install mcp httpx`
2. 配置 Claude Desktop 的 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "seedance25": {
      "command": "python",
      "args": ["/absolute/path/to/foxai_sd2.5/claude/mcp-server.py"]
    }
  }
}
```

3. 重启 Claude，会出现 `seedance25_specs`、`seedance25_generate`、`seedance25_validate` 三个工具

## Seedance 2.5 提示词标准（来源：字节跳动官方）

### 通用 6 要素公式

`主体 + 动作 + 镜头 + 光线 + 风格 + 声音`

### 通用 2.5 结构

`[Reference declaration] + [one-line overview] + [storyline or timestamp progression] + [global locks]`

### 标准契约输出模板

```text
【素材说明】
@图片1用于[身份/服装/场景/首帧]；@视频1仅用于[动作/运镜/节奏]；@音频1用于[音色/BGM]。

【一句话概述】
[主体]在[地点]完成[事件]，[题材/风格]，[核心镜头语言]。

【时间轴】
0-X秒：[画面、动作、镜头、对白、音效]。
X-N秒：[由上一段状态自然延续的画面、动作、镜头、对白、音效]。

【全局补充】
[角色/服装/道具/场景/光影/音频连续性]。不要[与任务相关的 unwanted elements]。
```

### 平台标签

保留平台原样的 `@图片1` / `@视频1` / `@音频1` 标签（大小写、空格、数量都不能改）。

## 12 种契约模板

详见 `src/contracts.js` 与 `claude/SKILL.md`。

## Context 7 集成

插件支持通过 Context 7 HTTP API (`https://context7.com/api/v1`) 实时查询最新 Seedance 2.5 文档。

使用方式：
1. 在工具调用中设置 `source: "context7"`
2. 插件会尝试调用 Context 7 API
3. 如果 Context 7 不可用，自动回退到嵌入式契约库（速度更快）

```javascript
seedance25_specs({
  contract_id: "standard",
  source: "context7",
  topic: "standard contract"
})
```

## 提示词生成原则

✅ **DO**：
- 主体稳定、可识别（年龄/材质/颜色/形态）
- 动作单一连续弧线
- 镜头明确（景别、角度、运动）
- 光线具体（方向、强度、色温）
- 风格单一
- 声音意图明确

❌ **DON'T**：
- 使用泛化美化词（`stunning`、`epic`、`8K`、`震撼`、`极致`等）
- 把 5 个无关动作塞进一段
- 只写"电影感光"而不指明光源
- 组合多种冲突的风格（35mm + 水彩 + 动漫）
- 模糊时间轴（缺少起点/终点）

## 许可

MIT License - FoxAI

## 参考资料

- [字节跳动 Seedance 2.5 官方文档](https://seedance2video.io/seedance-2-5)
- [Seedance 2.5 Prompt Guide](https://seedance2video.io/blog/ai-video-prompt-formula-seedance-2-5)
- [Seedance ShotDesign Skills (GitHub)](https://github.com/woodfantasy/Seedance-ShotDesign-Skills)
- [Context 7 MCP](https://context7.com)
