# foxai-h3-video-prompt

**MiniMax H3（海螺3 / Hailuo 3）视频提示词导演** —— 用户输入朦胧的文字意向（一个词、一种情绪、一句话），输出可直接粘贴到海螺官网或 H3 API 的专业文生视频提示词。

Claude Code skill（纯提示词工程，零依赖、零脚本）。

## 能力

- **朦胧意向 → 专业提示词**：情绪词（治愈/孤独）、主体词（猫/咖啡）、风格词（赛博朋克/国风）都能直接扩写成完整分镜级提示词；默认不反问，直接替用户做导演决策，附 2 条备选方向
- **双输出模式**：
  - **海螺官网版**（中文，默认）：核心创意 + 画面过程 + 声音设计 + 负面约束，经 H3-Context-IR 转写效果最佳
  - **API 结构化版**（英文）：`integrated_multimodal_description` / `overall_soundscape` / `non_diegetic_music` 三字段 + `[Shot N]` 时间戳 + `(S1)` / `<d>[语言]</d>` 对白系统（fal.ai / deAPI / 开源权重直连必用）
- **图生视频多分镜**：四宫格/序列图 → 连贯叙事（源自本目录上游文档《MiniMax H3 图生视频自动提示词 · 多分镜连贯系统》）
- **知识内核**：MiniMax 官方 Prompting Guidance（H3-Context-IR）+ fal.ai 44 例指南 + deAPI 结构化 T2VA 实测对照 + 海螺官网实践

## 文件

| 文件 | 说明 |
| --- | --- |
| `foxai-h3-video-prompt/SKILL.md` | 主入口：工作流、双模板、质量自检、反模式 |
| `foxai-h3-video-prompt/references/intent-to-storyboard.md` | 朦胧意向方法论：意向分类、情绪→视听速查表（10 情绪）、风格锚点表（10 风格）、导演决策 9 项、快速成片公式 |
| `foxai-h3-video-prompt/references/h3-format-and-spec.md` | 结构化格式全规范：三字段、时间戳语法、运镜词汇表、对白系统、规格表、8 条官方技巧、常见错误 |
| `foxai-h3-video-prompt/references/prompt-library.md` | 已验证示例库：中文官网版 5 例 + 英文结构化版 5 例（含 casual vs structured 对照） |
| `foxai-h3-video-prompt/references/image-to-video-multishot.md` | 图生视频多分镜连贯系统（一致性锁定 + 时间轴绑定 + 强连贯规则） |
| `foxai-h3-video-prompt.skill` | 上述 skill 目录的 zip 分发包 |

## 安装（Claude Code）

```bash
# 项目级
unzip foxai-h3-video-prompt.skill -d .claude/skills/
# 用户级（全局可用）
unzip foxai-h3-video-prompt.skill -d ~/.claude/skills/
```

之后在 Claude Code 里说「用 H3 帮我把『治愈』写成一个视频提示词」即可触发。

## H3 关键规格速记

4–15 秒 / 24fps / 768p（2K 仅官网）/ 21:9 · 16:9 · 4:3 · 1:1 · 3:4 · 9:16 / 提示词 ≤7000 字符 / 无 negative prompt 参数（排除项写正文）/ 音画联合生成（32kHz 立体声）/ 11 语言口型同步 / 台词 ≈2.5 词/秒。
