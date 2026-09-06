# H3 结构化格式全规范（API / 开源权重直连时必读）

海螺官网（hailuoai.video / 海螺 App）自带 H3-Context-IR 预处理，会把自然语言提示词改写成结构化格式；直连 API（fal.ai / deAPI / MiniMax 开放平台）或跑开源权重时**没有这层预处理，你就是 Context-IR**，必须按本规范写。

## 一、三字段结构（顺序与字段名不可改）

```text
integrated_multimodal_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...
```

这三个字段名是训练格式的一部分，改名或缺失等于提交缺 key 的 JSON。

### integrated_multimodal_description（主描述）

画面与剧情的一切：视觉风格、构图、主体外观、动作、运镜、镜头切换、台词、角色能听到的声音（收音机、手机铃）。按**播放顺序**从第一帧写到最后一帧。

- 复杂多镜头场景：**350–450 词**；简单单镜头：**150–250 词**。低于 100 词必扩写。
- 开头 `[Shot 1]` 先给风格与初始构图。风格词（官方推荐集）：`Live-action` / `Cinematic` / `2D-animated` / `3D CG` / `Claymation` / `Watercolor` / `Vintage film`。

### overall_soundscape（环境声）

1–4 句：全片的环境声、物理动作声、人声非语言声（呼吸、脚步、布料）。**不要**在此重复台词和配乐——它们各有各的家。

### non_diegetic_music（配乐）

1–3 句：只有观众听得到的配乐。写**乐器 + 速度 + 动态变化**。抽象情绪词（“tense emotional music”）无效；写 “a sustained low cello note held under the dialogue”。无配乐写 `N/A`（写实场景常常更好）。

## 二、镜头与时间戳

- `[Shot 1]` **不带**时间戳；之后每个镜头用 `MM:SS.mmm` 且严格递增：

```text
[Shot 2] At 00:04.500, the camera cuts to a close-up...
```

- 时间戳表示「新镜头何时开始」，不是动作持续多久。
- 剪辑密度：约每 3 秒 1 剪；每镜头 ≥3 秒；双镜头场景 ≈8 秒最佳，单节拍 ≈5 秒。
- 写作顺序：**先定总时长 → 排剪辑点 → 填内容**。

## 三、运镜语法

运镜写成**句子内的自然动作**，不是行尾标签：

> ✅ The camera pushes in with small amplitude at slow speed toward the folded letter.
> ❌ ..., push in, small amplitude, slow speed.

| 维度 | 取值 |
| --- | --- |
| 运动类型 | Zoom In/Out（变焦推拉）· Push In / Pull Out（机位推拉）· Pan Left/Right（横摇）· Truck Left/Right（横移）· Tilt Up/Down（纵摇）· Pedestal Up/Down（升降）· Arc Shot（环绕）· Tracking Shot（跟随）· Static Shot（固定）· Shake Slightly/Strongly（轻/强晃动）· POV（主观视角）· Roll Clockwise/Counterclockwise（旋转） |
| 幅度 | `with small amplitude` / `with large amplitude`（中等省略） |
| 速度 | `at slow speed` / `at fast speed`（常速省略） |

电影技术词汇 H3 直接读得懂：`rack focus`（焦点转换）、`wide-angle lens with strong perspective distortion`、`fine grain, soft highlight halation`、`backlit exposure breathing`、`shallow depth of field`、`slow motion`。转场写成物理事件而非效果名（“whip pan with motion blur, cut at peak blur, snap back into focus”）。

## 四、对白系统（有台词必读）

H3 生成 11 种语言的口型同步对白：中、英、日、韩、法、德、西、葡、意、俄、阿拉伯。

**说话人编号**：开口的人按首次发声顺序拿稳定 ID `(S1)` `(S2)`，全程不变；不说话的人没有 ID。

**对白标签**：台词放 `<d>` 标签内并标语言，其余（说话人描述、语气、动作）在标签外：

```text
The young woman with a quiet, breathy voice (S1) says:
<d>[Chinese] 我还以为雨停了。</d>
```

**画外音**：用固定短语 `says in an off-screen voiceover`，并**紧跟一句**嘴唇闭合声明，否则 H3 会给某个人物配上口型：

```text
The man (S1) says in an off-screen voiceover:
<d>[Chinese] 我还记得那条路。</d>
while his lips remain completely closed.
```

**字数预算**：自然语速 ≈ 2.5 词/秒（中文 ≈ 4 字/秒）。10 秒全片台词 ≤ 20–25 词，且首尾留白。台词超载会被赶语速或截断。

**一镜头一个说话人**：干净的口型同步最可靠的一招。两人对话靠正反打剪辑。

## 五、画面内文字

画面里可见的文字（招牌、横幅、标签、手机屏）用英文双引号原文写出，且要求大字号、高对比（量化后小字最先糊）：

```text
A red neon sign reading "OPEN LATE" glows above the doorway.
```

## 六、负面指令

API 无 negative prompt 参数，但**正文里的负面指令在 H3 上异常有效**（官方示例大量使用），写具体的：

- `No soft dissolves or fluid morphs.`
- `Do not introduce garbled characters or misspellings.`
- `No tearing, black frames, hard cuts, or compositing seams.`
- 中文版：`不要字幕，不要水印，不要出现额外角色，不要写实皮肤纹理。`

## 七、一切可观察（贯穿所有字段的铁律）

每个子句必须描述观众**看得见或听得着**的东西。

| ❌ 抽象（无效） | ✅ 可观察（有效） |
| --- | --- |
| 她感到被抛弃 | 她垂下目光，肩膀下沉 |
| 忧郁的氛围 | 雨痕划过窗玻璃，灰光充满房间 |
| 紧张的情绪化配乐 | 对白下方持续一根低音大提琴长音 |
| 史诗感场面 | 镜头拉出，揭示峡谷全貌 |
| 表情生动、手势细腻（内部特质） | 台词间低头看桌面一眼，再抬头 |

## 八、规格速查

| 参数 | 值 |
| --- | --- |
| 时长 | 4–15 秒（fal 5–15 秒） |
| 帧率 | 24 fps 固定 |
| 分辨率 | 短边 768p；2K 仅官网/托管模块 |
| 画幅 | 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 |
| 音频 | 32kHz 立体声，与画面同模型联合生成 |
| 提示词上限 | 7,000 字符 |
| negative prompt | 不支持（写正文） |
| 架构 | 33B 全模态 dense transformer，文本编码器 Qwen3-VL-32B |
| 参考（R2V 模式） | 最多 9 图 + 3 视频（各 2–15s）+ 3 音频，共 ≤12 文件 |

## 九、官方技巧（fal.ai 44 例指南提炼）

1. **给每份参考素材一个明确职务**：“Image 1 负责整体氛围与胶片质感；Image 2 负责人物；Image 3 负责产品”，远强于四张图加一段描述。一份素材别包办三件事。
2. **超过一拍的内容写时间轴分镜**：`[0–2 seconds] ... [2–4 seconds] ...`，防止节奏滑坡成幻灯片。
3. **声音像镜头一样被导演**：写具体乐器、具体声源、节拍落点。
4. **负面指令要具体**（见 §六）。
5. **身份显式锁定**：列出定义角色的每个细节（发型/配饰/材质），跨镜头用「镜头一中的那个短发热」回指。
6. **给模型一个重复事件**：旋转的灯、闪烁的光、定期驶过的列车——时间锚点，减少长镜头漂移。
7. **迭代一次只改一个字段**：固定 seed，只改 `non_diegetic_music` 再生成。三字段对应不同子系统，隔离变量才能找到起作用的指令。
8. **角色用屏幕位置钉住**：“on the left / in the centre” 跨剪辑比服装描述更耐久。

## 十、常见错误（一票否决）

1. 写成无字段散文（低于 100 词的流水段）。
2. 配乐字段写情绪词（“紧张激昂”）——写乐器、速度、变化。
3. 时间戳越界（8 秒片里出现 `At 00:09.000`）或台词超载（6 秒塞 40 词）。
4. 声音放错字段：角色听得到的收音机 → 主描述；窗外雨声 → soundscape；配乐 → music。
5. 画外音漏写「嘴唇保持闭合」。
6. 要求「一镜到底」又同时要求多次剪辑；或同一镜头塞五个动作。
7. 没有参考图却要求「同一个人再出现」——文生视频模式锁不住跨生成身份，需要参考图请走图生视频/参考生视频模式。
