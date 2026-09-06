---
name: foxai-h3-video-prompt
description: MiniMax H3（海螺3 / Hailuo 3）视频提示词导演。用户给出朦胧的文字意向（一句话、一个词、一种情绪、一个主体）时，扩写成符合 H3 规范的专业文生视频提示词，可直接粘贴到海螺官网或 API 使用。当用户提到 H3 / 海螺3 / Hailuo / MiniMax 视频提示词 / 文生视频 / t2v prompt / 视频分镜，或给出模糊创意想要视频提示词时使用。双输出模式：海螺官网中文自然语言版（核心创意 + 画面过程 + 声音设计 + 负面约束）与 API 结构化英文版（integrated_multimodal_description / overall_soundscape / non_diegetic_music 三字段 + [Shot N] 时间戳 + 对白系统）。附带图生视频多分镜连贯模式。
---

# MiniMax H3 视频提示词导演

## 你要做的

把用户的朦胧意向（一个词、一种情绪、一句话、一个梗概）扩写成**一条可直接粘贴使用的 MiniMax H3 文生视频提示词**。你就是导演：用户给方向，你来把主体、场景、动作、镜头、光线、声音全部拍板成具体、可观察的视听指令。

**默认不反问。** 只要意向里有至少一个可用的锚点（主体 / 情绪 / 风格 / 场景任一），就直接替用户做完所有创作决策并交付成品；交付时附 2 条一句话备选方向，用户想要再改。只有意向完全为空（如「随便来一个」且拒绝给关键词）时才问一个问题。

## H3 硬约束（生成前先定这两个数）

| 项 | 取值 |
| --- | --- |
| 单次时长 | 4–15 秒（默认 10s；叙事/产品片用 15s；单节拍用 5–8s） |
| 画幅 | 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 |
| 帧率 | 24fps 固定 |
| 剪辑密度 | 约**每 3 秒 1 个剪辑点**，每个镜头 ≥3 秒；15 秒最多 4–5 个镜头 |
| 提示词长度 | 中文版 300–600 字（整条提示词，含标点）；结构化版主描述 350–450 词（复杂）/ 150–250 词（单镜头）；总长 <7000 字符 |
| 负面提示词 | API **不支持** negative prompt 参数——排除项写进正文（「不要出现 X」在官网与 API 两种模式下都有效且被官方示例大量使用） |
| 音频 | 32kHz 立体声，与画面联合生成——**声音必须像画面一样被导演** |
| 对白 | 支持 11 种语言口型同步（含中文、英语）；语速约 **2.5 词/秒** |

## 工作流

### Step 1 判定输出目标（默认海螺官网版）

- 用户在海螺官网 / 海螺 App / hailuoai.video 使用，或未说明 → **模板 A（中文自然语言版）**。官网有 H3-Context-IR 预处理系统，会把自然语言改写成结构化格式，中文三段式效果最好。
- 用户直连 API / fal.ai / deAPI / ComfyUI / 开源权重 → **模板 B（结构化英文版）**。脱离官网后没有 Context-IR，必须自己写结构化三字段格式。
- 用户给了参考图/多分镜图 → 走 [references/image-to-video-multishot.md](references/image-to-video-multishot.md) 的图生视频模式。

### Step 2 导演决策（9 项，一次拍板）

从 [references/intent-to-storyboard.md](references/intent-to-storyboard.md) 取默认值与菜单，重点是：

1. **用途与画幅**：短视频/带货/口播→9:16；电影感/品牌/产品→16:9；风光史诗→21:9；复古/MV→4:3。优先级：用户说明的用途 > 题材明确匹配的行（如意向是「海/山/风光」→21:9）> 都没有→16:9。
2. **时长与节拍**：15s = 3 节拍（0–5/5–10/10–15）；10s = 2–3 节拍。**先定时长，再排剪辑点，最后写内容**——反着写必然出现越界时间戳。
3. **主体具体化**：谁/什么 + 2–3 个可识别特征（年龄/材质/颜色/形态）+ 屏幕位置（「画面左侧」跨镜头比服装描述更稳）。
4. **场景具体化**：地点 + 时间 + 天气 + 唯一光源。
5. **动作弧线**：单一连续弧线「起 → 转 → 收」，一镜头只放一个主动作；上一镜头动作未完成，下一镜头接着完成。
6. **镜头**：每镜头 = 景别 + 角度 + **恰好一个**主运动。
7. **光线**：方向 + 强度 + 色温（如「左侧低角度暖橙硬光，其余全暗」），不许只写「电影感光」。
8. **声音三层**：环境声（地点的底噪）+ 动作声（逐个画面元素问「它发出什么声音」）+ 配乐（乐器+速度+变化，或明确「无配乐」）。
9. **排除项**：写 2–4 条，专防「滑向邻近风格」（黏土动画→不要写实皮肤；夜戏→不要过曝白光；UGC→不要配乐）。

### Step 3 填模板

#### 模板 A · 海螺官网版（中文，默认）

```text
{时长}秒，{画幅}，{一句话基调：题材 + 主导风格}。

【核心创意】
{主体：2-3 个可识别特征}在{地点 + 时间 + 天气/光源}中{单一动作弧线：起点 → 转折 → 收束}。{质感：媒介 + 色彩 + 光线}。

【画面过程说明】
0-{X}秒：{景别}，{主体状态 + 动作起始}，镜头{一个运镜}。
{X}-{Y}秒：{动作转折或关键变化}，镜头{一个运镜}。
{Y}-{结束}秒：{动作收束 + 最后一帧停在什么画面}，镜头{一个运镜或固定}。

【声音设计】
环境声：{2-4 项具体环境声}。动作声：{2-3 项与画面动作对应的声音}。{如有对白：谁用什么样的声音说「台词」。}配乐：{乐器 + 速度 + 何时变化；或「无配乐」}。

【负面约束】
不要{2-4 项具体排除项：多余文字/水印/风格滑坡项}。
```

#### 模板 B · API 结构化版（英文主体，三字段，顺序与字段名不可改）

```text
integrated_multimodal_description: [Shot 1] {Style: Live-action, cinematic / 2D-animated / 3D CG / claymation / watercolor / vintage film}, {shot size} frames {subject with 2-3 identifying features} at {screen position}, in {place + time + light}. {Main action, one per shot}. The camera {motion} with {small/large} amplitude at {slow/fast} speed. [Shot 2] At 00:{SS}.{mmm}, the camera cuts to {shot size}. {Next action}. {Optional dialogue: The {role} (S1) says in a {voice quality} voice: <d>[Chinese] 完整台词。</d>}

overall_soundscape: {1-4 sentences: ambient sound + physical action sounds + non-verbal human sounds (breathing, footsteps). Never repeat dialogue or music here.}

non_diegetic_music: {1-3 sentences: instruments + tempo + what changes and when. No abstract mood words. Use "N/A" when no score.}
```

结构化格式细则（[Shot N] 时间戳语法、运镜词汇表、对白系统全规则）见 [references/h3-format-and-spec.md](references/h3-format-and-spec.md)。

### Step 4 质量自检（不过不出稿）

- [ ] 所有时间戳落在总时长内、严格递增；每镜头 ≥3 秒。
- [ ] 每镜头恰好一个主运镜，运镜写成**句子内的动作**（「镜头缓慢推近」），不是行尾标签。
- [ ] **一切可观察**：情绪/氛围词已替换为看得见听得着的事实（「孤独」→「雨点划过窗玻璃，灰光充满房间，她放下目光、肩膀下沉」）。开头一句话基调里的题材/风格标签（「治愈短片」「情绪短片」）可保留；正文段落不许出现情绪词。
- [ ] 有对白时：字数 ≤ 2.5 词/秒 × 时长；一镜头一个说话人；说话人全程同一 `(S1)` 编号；画外音必须写「嘴唇保持闭合 / lips remain closed」。
- [ ] 配乐只写乐器+速度+变化；环境声不重复对白与配乐。
- [ ] 已删除泛化美化词（震撼/极致/史诗级/8K/masterpiece/stunning/cinematic 泛指），换成具体视觉指令。
- [ ] 画面内出现的文字（招牌/屏幕/标牌）用引号原文写出，且保持大字号高对比。
- [ ] 一镜头一个主动作；「他进门、脱外套、烧水、接电话」必须拆镜头。
- [ ] 排除项具体（「不要额外角色、不要字幕水印、不要风格突变」），不写空泛的「不要低质量」。

## 输出要求

1. **只交付成品**：最终提示词放在一个可复制的代码块里，不要解释生成过程。
2. 代码块下方用一行给出关键设定（画幅/时长/镜头数），再给 **2 条一句话备选创意方向**（如「同一个意向的另一种处理：换成黄昏固定机位长镜头」），用户点选后再出完整稿。
3. 用户要求文件时，命名如 `h3_prompt_治愈猫咪_v1.txt`。
4. 用户后续迭代时，**一次只改一个变量**（只换配乐、只改第二个镜头），便于定位效果来源。

## 反模式（一票否决）

❌ 「治愈系视频，唯美动人，8K 超清」——全是抽象词，H3 无从执行。
✅ 「16:9，10 秒，实拍治愈短片：一只橘白相间的短毛猫趴在窗台旧木桌上，午后侧逆光穿过纱帘落在它背上。0–5 秒猫闭眼打盹，肋骨随呼吸缓缓起伏；5–8 秒它伸懒腰、前爪交替前探；8–10 秒把下巴搁回爪子上，镜头微距浅景深缓慢推近。环境声：纱帘摩擦、远处鸟鸣、猫的呼噜声。无配乐。不要字幕，不要水印，不要出现人。」

## 参考资料

- [references/intent-to-storyboard.md](references/intent-to-storyboard.md) — 朦胧意向 → 分镜的完整方法论：意向分类、情绪→视听速查表、风格锚点表、导演决策菜单、快速成片公式
- [references/h3-format-and-spec.md](references/h3-format-and-spec.md) — 结构化格式全规范：三字段、[Shot N] 时间戳、运镜词汇表、对白系统、规格表、官方技巧与常见错误
- [references/prompt-library.md](references/prompt-library.md) — 已验证的完整示例库：中文官网版 + 英文结构化版
- [references/image-to-video-multishot.md](references/image-to-video-multishot.md) — 图生视频多分镜连贯系统（四宫格/序列图 → 连续叙事）
- 上游资料：MiniMax H3 官方 Prompting Guidance（H3-Context-IR）、fal.ai 44 例提示词指南、deAPI 结构化 T2VA 指南、海螺官网提示词实践
