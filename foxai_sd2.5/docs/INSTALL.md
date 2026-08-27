# foxai_sd25_video 安装与使用指南

## 已构建好的产物

本插件已完整开发并构建完成。当前目录包含：

```
foxai_sd2.5/
├── dist/
│   ├── host-bundle.js      ← Host 端代码（35KB）
│   ├── client-bundle.js    ← Client 端代码（30KB）
│   └── cordis-args.json    ← cordis_define 完整入参（69KB）
├── src/                     ← 核心源代码（4 个模块）
├── claude/                  ← Claude 兼容文件（SKILL.md + MCP server）
├── docs/                    ← 文档
├── install.sh               ← 自动化安装脚本
└── build.js                 ← 构建脚本
```

## 安装方式

### 方式一：在 DeepSeek Harness 中通过 AI 工具安装（推荐）

**步骤 1**：构建（如果还没构建）

```bash
cd /Users/foxai/Desktop/dshplugin/foxai_sd2.5
./install.sh
# 或手动：
node build.js
node build-cordis-args.js
```

**步骤 2**：复制 `dist/cordis-args.json` 的内容

**步骤 3**：在 DeepSeek Harness 中，对 AI 说：

> "请用 cordis_define 工具定义插件，参数在 `/Users/foxai/Desktop/dshplugin/foxai_sd2.5/dist/cordis-args.json` 中。"

AI 会读取文件并调用 `cordis_define`，返回 `pluginId` 和 `packageId`。

**步骤 4**：用返回的 ID 调用 `cordis_run`：

> "请用 cordis_run 激活刚才定义的插件，pluginId 是 `<id>`，packageId 是 `<id>`，mode='run'。"

**步骤 5**：首次运行会触发**审批请求**（`awaiting-approval`）。在 Web GUI 中批准。

**步骤 6**：激活成功后，AI 会自动获得以下 3 个工具：
- `seedance25_specs`：获取 Seedance 2.5 提示词契约规范
- `seedance25_generate`：生成符合标准的提示词
- `seedance25_validate`：校验提示词

### 方式二：在 Claude 中使用

#### 方案 A：Claude Skill（最简单）

1. 打开 `/Users/foxai/Desktop/dshplugin/foxai_sd2.5/claude/SKILL.md`
2. 在 Claude 中：
   - 直接粘贴 Skill 内容（如果支持自定义 Skill）
   - 或者把文件内容复制到对话开头

#### 方案 B：MCP 服务器（更强大）

1. 安装依赖：`pip install mcp httpx`
2. 编辑 Claude Desktop 配置 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "seedance25": {
      "command": "python",
      "args": ["/Users/foxai/Desktop/dshplugin/foxai_sd2.5/claude/mcp-server.py"]
    }
  }
}
```

3. 重启 Claude Desktop，会出现 `seedance25_specs`、`seedance25_generate`、`seedance25_validate` 三个工具

## 使用示例

激活后，用户对话即可生成 Seedance 2.5 标准提示词。

### 示例 1：4-30 秒标准短视频

**用户输入**：
> 我想做一个 10 秒的浪漫短片，一位 25 岁东亚女性在雨后的东京街头，撑伞走过霓虹招牌。

**AI 工作流程**：
1. 调用 `seedance25_specs(contract_id="standard")` 获取契约模板
2. 根据用户描述填写结构化输入（主体、动作、镜头、光线、风格、声音、时间轴）
3. 调用 `seedance25_generate(contract_id="standard", input={...})` 生成提示词
4. 调用 `seedance25_validate(prompt=...)` 校验质量
5. 输出最终提示词

**最终输出**：
```text
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

用户可以直接复制粘贴到 Seedance 2.5 本生视频生成入口。

### 示例 2：复杂 30 秒

**用户输入**：
> 帮我做一段 30 秒的"霓虹小巷的邂逅"视频，主角是 25 岁东亚女性，齐肩黑发，驼色风衣。

**AI 输出**：
```text
30秒霓虹小巷的邂逅。

【多模态参考层】
@图片1用于女主身份与服装。

【全局设定】
环境与质感：夜晚东京小巷，潮湿沥青路面，霓虹灯反射
视觉风格：35mm胶片，高对比，暖橙与冷青色霓虹
镜头语言：手持跟拍，浅景深
角色/主体：女主25岁，东亚面孔，齐肩黑发，驼色风衣
表演核心：低头看手机→抬头环顾→与镜头对视轻笑
全局限制：保持服装、面孔与光影一致性；不要硬切；不要背景音乐；仅保留环境音与脚步声

【时间戳剧本】
00:00-00:10秒：女主低头看手机走过巷口，霓虹招牌反射在湿地面。
00:10-00:20秒：她抬头环顾，脚步放缓，与镜头短暂对视。
00:20-00:30秒：轻笑后继续走向巷子深处，镜头跟拍至背影消失。
```

### 示例 3：可视化构建器（仅 DSH）

激活插件后，`cordis_run` 卡片中会出现"Seedance 2.5 视频提示词生成器"面板：
- 下拉菜单选择 12 种契约之一
- 自动渲染对应的表单字段
- 一键生成、复制、校验

## 12 种支持的契约

| 契约 ID | 名称 | 时长范围 |
| --- | --- | --- |
| `standard` | 标准生成 | 4-30s |
| `simple` | 压缩版 | 4-15s |
| `complex_30s` | 复杂 30 秒 | 30s |
| `ultra_long` | 超长视频 | 30-180s |
| `extension` | 视频延长 | - |
| `editing` | 智能编辑 | - |
| `creative_transfer` | 创意迁移 | - |
| `voice_dialogue` | 语音与多语言对白 | - |
| `green_screen` | 绿幕合成 | - |
| `white_model` | 白模渲染 | - |
| `transition` | 无缝转场 | - |
| `storyboard` | 多格分镜 | - |

## Context 7 集成

插件支持通过 Context 7 实时查询最新 Seedance 2.5 文档：

```javascript
seedance25_specs({
  contract_id: "standard",
  source: "context7",  // 启用 Context 7
  topic: "standard contract"
})
```

如果 Context 7 不可用，自动回退到嵌入式契约库（仍然完整可用）。

## 故障排查

### 插件定义失败
- 检查 `dist/host-bundle.js` 和 `dist/client-bundle.js` 是否存在
- 重新运行 `./install.sh`

### 审批被拒绝
- 在 DSH GUI 中重新触发（可能需要重新定义）
- 检查 Cordis Plugin 的权限设置

### 工具调用失败
- 检查 `seedance25_specs` 是否能正常返回（验证插件激活）
- 在对话中要求 AI "用 seedance25_specs 测试一下"

## 技术细节

- **插件 ID 前缀**：`foxsd`（Fox + Seedance）
- **依赖**：仅 Cordis runtime（无外部 npm 依赖）
- **大小**：Host 35KB + Client 30KB（已 minify）
- **Cordis 版本**：兼容 Cordis 0.x

## 许可

MIT License - FoxAI
