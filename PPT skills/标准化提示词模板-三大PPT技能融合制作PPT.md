# 标准化提示词模板 · 三大 GitHub PPT Skill 融合制作可编辑 PPTX

> 适用场景:用一份文案(如 `汇报提纲.md`),融合 GitHub 三大最受欢迎 PPT skills 的优点,
> 产出**一个**既高级又可编辑的 PPTX 交付物。
> 三个 skill(git clone 到本地备查):
> 1. `zarazhangrui/frontend-slides`(★~30k)— 1920×1080 固定舞台、字号层级 112/34/28、防 AI 平庸味
> 2. `op7418/guizang-ppt-skill`(★~27k)— 瑞士网格纪律、锁定版式 S01–S22、官方校验器、单一强调色
> 3. `chuspeeism/dashi-ppt-skill`(★~9k)— 深色科技主题配方(环境光分层/点阵/发丝线/双语微标)、高级感 checklist
> 转换为可编辑 PPTX:官方 `pptx` skill 工作流(背景位图 + 原生文本框,逐行防重排)。

---

## 提示词模板(复制后填入【】部分)

```text
请为我制作一份汇报 PPT,严格按照以下要求执行:

【1. 文案(不可修改)】
文案文件:【例:汇报提纲.md】
- 严格使用文案原文的措辞,不得改写、不得增删事实;只做分页、断行与结构化提炼
- 汇报时长【例:12–13 分钟】,按每页 40–60 秒合理分页(约【14–16】页)
- 封面/目录/章节结构从文案章节推导,不加造事实、不编造数据

【2. 方法:融合三大 GitHub PPT skill 之长(单一交付物)】
先 git clone 以下三个仓库到 work/skills/ 并阅读其规范:
- zarazhangrui/frontend-slides → 取:1920×1080 固定舞台、字号体系(标题~112/副标~34/正文≥28px)、
  汉字零字距、英文标签大写字距、内容密度规则(每页单焦点,溢出就分页)
- op7418/guizang-ppt-skill → 取:瑞士网格纪律(12/16 列栅格、发丝线、直角无圆角无阴影)、
  版式多样性硬规则(≥8 个不同版式、不连续 3 页同构)、"越大越细"字重阶梯、
  并直接运行其官方校验器 validate-swiss-deck.mjs / validate-presenter-mode.mjs
- chuspeeism/dashi-ppt-skill → 取:高级感配方(近黑/深蓝底 + 单一高饱和强调色、
  环境光分层背景、点阵/细线装饰、双语等宽微标签、行内强调色纪律)
风格基调:【例:深空导航蓝 #0A1424 + 航空青强调 + 军事金点缀,科技感、高级感】
背景元素要求:【例:线稿飞机爬升轨迹、虚航线+航路点、雷达同心环、HUD 网格——封面隆重、内页轻量】
正文字号 ≥22px,对比度 ≥13:1,装饰不得压字。

【3. 交付物:根目录下的可编辑 PPTX(唯一交付物)】
- 转换管线(官方 pptx skill 工作流):HTML 同构设计 → Playwright/Chromium 1920×1080 逐页截图,
  再以"隐藏全部文字"截背景 JPG → 每个视觉行文字用 pptxgenjs 写为原生文本框
  (wrap:false 防重排;fontFace 用本机已装字体族名如 Noto Sans SC Light/Medium;latin+ea 双绑定)
- 文件名标注制作方式便于区分:【例:XXX汇报PPT【三技能融合·深空蓝金】.pptx】

【4. 质量闭环(必须执行)】
- 程序化版式检查:文本框越界/重叠检测脚本,ALL CLEAN 才继续
- 量化对齐校验:soffice --headless 转 PDF + pdftoppm 渲染,与 HTML 基准做逐框互相关,
  中位偏移 |dx|、|dy| ≤ 4px(≈2pt)才通过;大字/紧字族字体按实测加 em 级补偿
- 视觉终审:拼接全部页面蒙太奇,逐页查重叠/裁切/压字/风格统一,并按 1–10 打分
- 中文字体需同时装于 ~/Library/Fonts 与 /Applications/LibreOffice.app/.../truetype/(LO 校验用)

【5. 验收清单】
☐ 文案零改写 ☐ 分页合理 ☐ 每页可编辑(双击文本可直接改)
☐ 字体/排版统一 ☐ 背景含指定元素 ☐ 校验全部通过 ☐ 交付至根目录
```

---

## 本机可复用资产(已在 `work/` 沉淀)

| 脚本 | 作用 |
|---|---|
| `work/deck.html` + `render.js` + `check.js` | 设计稿、截图/测量、越界重叠检查 |
| `work/build.js` / `build2.js` | runs.json + 背景图 → 可编辑 PPTX(含字体映射与垂直校准) |
| `work/corr.js` | HTML vs LibreOffice 渲染逐框 NCC 位移校验(支持 REF/LO/RUNS 环境变量) |
| `work/yprof.js` / `edge.js` | 深底大字的垂直质心 / 行宽边缘确定性校验(NCC 伪差的裁决手段) |
| `work/deck2/` + `render2.js` | guizang 瑞士风版(任意模板标记的逐视觉行提取) |

经验校准值:全局 y +2px;Rajdhani +0.09em;≥90px 展示字 +0.11em(细体 Light 约 +0.14em);
行高>1.3 的行 −4px;lineSpacing = 浏览器实测行框高(而非字号),是避免基线上飘的关键。
