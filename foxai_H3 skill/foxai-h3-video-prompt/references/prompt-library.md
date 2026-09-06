# H3 提示词示例库

两部分：A 海螺官网中文版（自然语言，经 H3-Context-IR）；B API 结构化英文版（deAPI 实测对照案例，casual vs structured 同场景对比）。

---

## A. 海螺官网版（中文）

### A1. 治愈系猫咪（输入意向：「治愈」）

```text
10秒，16:9，实拍治愈短片。

【核心创意】
一只橘白相间的短毛猫趴在铺旧木桌布的窗台上，右耳有一小块黑色，午后侧逆光穿过纱帘落在它背上，尘埃在光柱里漂浮。0-5秒它闭眼打盹，肋骨随呼吸缓缓起伏；5-8秒伸懒腰、前爪交替前探；8-10秒下巴搁回爪子上，眼睛重新闭起。微距浅景深，暖色调低对比。

【画面过程说明】
0-5秒：微距特写，猫闭眼蜷卧，呼吸起伏清晰可见，镜头固定。
5-8秒：中近景，猫前伸前爪拉长脊背，镜头缓慢推近。
8-10秒：特写，猫下巴轻搁前爪，最后一帧停在它半闭眼的侧脸，镜头固定。

【声音设计】
环境声：纱帘轻摩擦、窗外远处鸟鸣。动作声：猫的低频呼噜声、爪垫在木桌上轻轻挪动。配乐：无配乐。

【负面约束】
不要出现人，不要字幕，不要水印，不要突然的响声。
```

### A2. 城市夜景电影感（输入意向：「赛博朋克的城市」）

```text
10秒，16:9，电影感实拍，夜间未来城市。

【核心创意】
夜间的未来城市密布蓝与品红的霓虹广告牌，飞行器在镜面摩天楼之间穿行，雨后湿滑的街道把霓虹倒影拉成双色光带。0-5秒大远景航拍前推，镜头以大幅度慢速在塔楼之间滑行，玻璃上的反光拉出条纹；5-10秒镜头以中等幅度下摇，揭示下方雨渍街道，积水里霓虹招牌的倒影随车流碎动。

【画面过程说明】
0-5秒：大远景航拍，镜头随画面主体前进方向跟踪移动，大幅度慢速，穿行于楼群之间。
5-10秒：镜头下摇至中景，湿街车流穿过光带，霓虹招牌"OPEN LATE"在积水中倒映，画面收束于一辆车尾灯远去。

【声音设计】
环境声：城市低频嗡鸣、雨打玻璃与金属的嘶嘶声。动作声：飞行器由远及近再远去的啸叫、轮胎碾过积水。配乐：中速合成器琶音脉冲叠持续低音，尾段一次滤波上扬后收掉。

【负面约束】
不要日间光线，不要自然色调，不要字幕水印，不要额外角色面部特写。
```

### A3. 产品广告（输入意向：「给咖啡拍个广告」）

```text
10秒，16:9，产品级商业广告质感。

【核心创意】
一支主光从左侧切进暗调环境。0-4秒微距：烘焙咖啡豆撒落在粗粝木桌面上，逐颗弹跳、滚进木纹缝隙；4-8秒切陶瓷杯特写：热水细流注入，泡沫在液面旋转，蒸汽逆光上升；8-10秒镜头小幅度缓慢拉出，定格在一杯完整咖啡与散落豆子的静物构图。

【画面过程说明】
0-4秒：微距俯拍，豆子弹跳落定，镜头固定，浅景深。
4-8秒：杯口特写，水流注入音调随液面升高而上升，镜头轻微环绕。
8-10秒：中景静物，镜头缓慢拉出后固定，蒸汽持续上升，最后一帧为完整产品构图。

【声音设计】
环境声：安静房间底噪。动作声：豆子砸落木板的脆响连成一串、液体注入陶瓷杯（音调渐升）、杯柄轻碰桌面一声。配乐：慢速立式贝斯与刷鼓，中段加入暖音电钢琴，结尾淡出。

【负面约束】
不要出现人手，不要品牌标识，不要字幕，不要快剪。
```

### A4. 竖屏 UGC 口播带货（输入意向：「帮我拍个带货口播」，带对白）

```text
15秒，9:16，手持自拍 UGC 质感。

【核心创意】
一位二十多岁的女生在窗边明亮房间里单手持手机自拍，手里举起一小瓶精华，全程像随手拍的日常分享。0-6秒开场介绍；6-12秒转瓶身展示标签并给出使用感受；12-15秒收尾行动号召。手持轻晃、窗光自然、偶尔对焦迟半拍，不摆拍。

【画面过程说明】
0-6秒：手持自拍近景，她把小瓶举到镜头前，一边转瓶一边说台词一。
6-12秒：她把瓶身标签转向镜头，倾斜让光透过瓶身，说台词二。
12-15秒：她凑近镜头压低声音说台词三，笑着把瓶子收回，最后一帧停在她的笑脸。

【声音设计】
环境声：室内底噪、窗外隐约街道声。动作声：瓶盖"咔"一声、布料摩擦。对白：（轻快自然的语气）「这瓶我用了整整一周了。」；（转头看瓶子再回镜头）「说实话，没指望它这么快有效果。」；（凑近镜头）「链接放下面了，冲。」配乐：无配乐。

【负面约束】
不要电影感打光，不要稳定器画面，不要配乐，不要字幕（后期另加）。
```

### A5. 情绪短片（输入意向：「孤独」，21:9）

```text
15秒，21:9，写实情绪短片。

【核心创意】
末班地铁的空车厢，凌晨。一个二十多岁的年轻人独自坐在长条座椅靠窗一端，齐耳短发、深灰针织衫，车窗外隧道的灯一格一格扫过他的脸。0-6秒车厢大远景，人物只占画面一角；6-11秒车窗特写，玻璃上他的倒影与隧道灯重叠；11-15秒到站，他起身走出画面，车门合上，车厢彻底空掉。

【画面过程说明】
0-6秒：大远景固定机位，车厢纵深透视线引向人物，窗外灯光规律掠过。
6-11秒：中近景，焦点在车窗玻璃的倒影上，人物在焦点外，镜头固定。
11-15秒：全景固定，他起身走向车门下车，车门合拢，最后一帧是空车厢与仍在掠过的灯光。

【声音设计】
环境声：轨道接缝的节律声、日光灯电流声、车厢连接处偶尔的金属吱呀。动作声：起身时衣料摩擦、脚步、车门开合提示音与气动声。配乐：无配乐。

【负面约束】
不要其他乘客，不要字幕，不要配乐，不要戏剧化表演。
```

---

## B. API 结构化版（英文三字段，deAPI 实测：casual vs structured）

### B1. 产品广告（咖啡）— 结构化版

```text
integrated_multimodal_description: [Shot 1] Live-action, cinematic commercial, a macro close-up frames roasted coffee beans tumbling onto a rustic wooden table, each bean bouncing and settling into the grain. The camera pulls out with small amplitude at slow speed as the beans come to rest under warm directional light. [Shot 2] At 00:04.500, the camera cuts to a close-up of a white ceramic cup as hot coffee pours in a steady stream, foam swirling on the surface and steam curling upward through the light.

overall_soundscape: Hard coffee beans clatter and skitter across bare wood, settling into a rolling patter. A steady stream of hot liquid pours into a ceramic cup, its pitch rising as the cup fills, over a quiet room tone.

non_diegetic_music: A slow upright-bass line with brushed drums at a relaxed tempo, joined midway by a warm electric piano that fades out at the end.
```

（对照的 casual 版只有 64 词、堆 “comforting, cozy” 情绪词，实测构图更松、音频不匹配。）

### B2. AI 新闻主播（带对白 + 口型同步）

```text
integrated_multimodal_description: [Shot 1] Live-action, broadcast studio look, a medium shot frames a news presenter (S1) behind a dark desk in a sleek modern studio, screens glowing blue behind them. The camera pushes in with small amplitude at slow speed as the presenter looks to camera, and with a clear, measured voice says:
<d>[Chinese] 晚上好。我们首先关注今晚正在进展的报道。</d> They glance down at the desk, then back up. [Shot 2] At 00:06.500, the camera cuts to a tighter close-up as the presenter continues: <d>[Chinese] 我们的记者已经在现场。</d>

overall_soundscape: A quiet studio room tone with a faint air-handling hum. Paper shifts once on the desk and fabric rustles as the presenter turns.

non_diegetic_music: A short brass-and-synth sting at a moderate tempo under the opening, settling into a low sustained pad.
```

（教训：casual 版写 “expressive eyes, subtle hand gestures” 这类内部特质无效；结构化版删掉它们，改写成台词 + 台词间的物理动作。）

### B3. UGC 自拍测评（显式 N/A 配乐）

```text
integrated_multimodal_description: [Shot 1] Live-action, handheld selfie-style, a close-up frames a young woman (S1) holding the camera at arm's length in a bright room, daylight from a window on her face. The camera shakes slightly at normal speed as she turns a small product toward the lens and, with a warm conversational voice, says: <d>[English] Okay so I've been using this for about a week now.</d> She tilts it to show the label. [Shot 2] At 00:06.000, the camera holds as she looks back to lens and adds:
<d>[English] Honestly? I did not expect it to work this fast.</d>

overall_soundscape: A quiet indoor room tone with faint street sound beyond the window. Fabric brushes the microphone as the arm shifts, and the product's cap clicks once.

non_diegetic_music: N/A
```

（`N/A` 是刻意决策：UGC 场景加配乐即穿帮。手持晃动 + 房间底噪 + 口语台词比任何 “authentic mood” 关键词都更真实。）

### B4. 电影感城市夜景（无对白，双镜头）

```text
integrated_multimodal_description: [Shot 1] Live-action, cinematic, a wide aerial shot frames a nighttime futuristic city dense with neon billboards in blue and magenta, flying vehicles threading between mirrored skyscrapers. The camera performs a tracking shot forward with large amplitude at slow speed, gliding between towers as reflections streak across wet glass. [Shot 2] At 00:05.000, the camera tilts down with medium amplitude to reveal rain-slick streets far below, neon signage doubled in the standing water as traffic flows through the canyon.

overall_soundscape: A deep city hum carries the rising and falling whine of vehicles passing overhead. Rain hisses against glass and metal, and distant traffic echoes between the towers.

non_diegetic_music: A pulsing synthesizer arpeggio at a steady mid tempo over sustained low bass, with a filtered swell that builds and then drops away.
```

（教训：casual 版的四个名词短语只描述了一张静图；结构化版把名词变成 10 秒的运镜。）

### B5. 手绘生物混实拍（fal 实例，纯文生视频 15s）

```text
15 seconds, 16:9 landscape. Blend live-action footage of a small kitchen at dusk with hand-drawn luminous animation. The last sunset light lingers at the window. The lived-in kitchen contains an old wooden table, a half-washed mug, a lightly fogged glass bottle, and a hanging dish towel.

Shoot as if someone is filming one-handed on a phone: subtle hand tremor, hesitant close-focus pulls, backlit exposure breathing, and slightly coarse noise in the shadows. It should feel like an astonishing event captured in a rush at home, not a carefully dressed commercial.

Do not show giant eyes, split mouths, fangs, threatening behavior, lunges, sudden black frames, or jump scares. Use only room tone, cloth friction, a soft mug clink, faucet drips, the camera operator's footsteps and quiet breathing, plus gentle electronic tones and tiny vocalizations from the drawn creatures.
```

（fal 直连也接受自然散文体——但注意它同样满足：时间性动作、具体声音清单、具体负面清单、单一主导风格。）

---

## 使用说明

- 中文版四段结构【核心创意】【画面过程说明】【声音设计】【负面约束】在官网经 Context-IR 转写后效果最好；有参考素材时在最前面加【参考素材说明】段（见 image-to-video-multishot.md）。
- 结构化版字段名、`[Shot N]`、`At 00:0X.XXX`、`(S1)`、`<d>[语言]</d>` 逐字保留，不要「优化」它们。
- 引用本库示例时按用户主体/场景替换内容，节奏结构（节拍分配、声音三层、负面清单）保持。
