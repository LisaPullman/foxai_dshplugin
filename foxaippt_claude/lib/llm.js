/**
 * LLM 调用模块 — 复用 Claude Code 本机的 API 配置(Anthropic 兼容协议)。
 *
 * 从环境变量读取(与 Claude Code 相同,无需单独配置 key):
 *   ANTHROPIC_BASE_URL    API 端点(如 https://open.bigmodel.cn/api/anthropic)
 *   ANTHROPIC_AUTH_TOKEN  Bearer Token(或 ANTHROPIC_API_KEY)
 *   ANTHROPIC_MODEL       当前 Claude Code 调用的模型(如 glm-5.3[1M],自动去掉 [..] 标签)
 *   FOXAIPPT_MODEL        可选,显式覆盖模型
 */

// ---------- 配置解析 ----------
export function resolveBaseUrl() {
  return process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
}

export function resolveModel() {
  const raw =
    process.env.FOXAIPPT_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    process.env.ANTHROPIC_DEFAULT_FABLE_MODEL ||
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL ||
    "";
  // 去掉 Claude Code 的上下文长度标签,如 glm-5.3[1M] → glm-5.3
  return raw.replace(/\[[^\]]*\]\s*$/, "").trim();
}

export function resolveApiKey() {
  return process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || null;
}

// ---------- Prompt ----------
function buildSystemPrompt() {
  return `你是资深的演示文稿(Presentation)内容策划专家。你的任务是把用户提供的长文案,拆解为一份结构清晰、逻辑递进、要点凝练的多页 PPT 大纲。

严格输出一个 JSON 对象,不要输出任何其他文字、解释或 Markdown 代码块。JSON 结构如下:
{
  "title": "整份演示的主标题",
  "subtitle": "副标题或一句话概述",
  "slides": [
    {
      "title": "本页标题",
      "subtitle": "可选的本页副标题,可省略",
      "bullets": ["要点1,一句话,凝练", "要点2"],
      "notes": "可选的演讲者备注,一句话"
    }
  ]
}

拆解要求:
1. 第一页自动作为封面页(cover):用全局 title/subtitle 渲染,不要单独放进 slides。
2. 中间页为内容页:每页 3~6 个要点,每个要点一句话,提炼关键信息,不要照抄原文长句。
3. 若原文有明显章节/主题切换,可插入"章节页"(section):只有 title 和 subtitle,没有 bullets。
4. 最后一页自动作为结束页(end):写一句总结/致谢,不要单独放进 slides。
5. 总页数(不含封面和结束页)控制在 6~14 页,视原文信息量而定。
6. 语言跟随原文主要语言。
7. 只输出合法 JSON,字段名必须与上面完全一致。`;
}

function buildUserPrompt(text) {
  return `请把下面的长文案拆解为 PPT 结构,严格按要求的 JSON 格式输出:\n\n${text}`;
}

/** 从模型输出文本中提取 deck JSON(容忍代码块包裹/前后杂文字) */
function parseDeckJson(full) {
  let parsed = null;
  try {
    parsed = JSON.parse(full);
  } catch {
    // 剥离可能的 Markdown 代码块后重试;再不行就截取首个 { 到末个 } 之间
    const candidates = [
      full.replace(/```json\s*/gi, "").replace(/```/g, "").trim(),
      full.slice(full.indexOf("{"), full.lastIndexOf("}") + 1),
    ];
    for (const c of candidates) {
      try {
        parsed = JSON.parse(c);
        break;
      } catch {
        /* try next */
      }
    }
  }
  if (!parsed || !Array.isArray(parsed.slides)) {
    throw new Error("模型输出无法解析为包含 slides 数组的 JSON");
  }
  return parsed;
}

/**
 * 调用当前 Claude Code 所用的模型,把长文案拆解为 PPT 结构。
 * @param {string} text 长文案
 * @returns {Promise<{model:string, deck:{title:string, subtitle:string, slides:Array}}>}
 */
export async function generateDeck(text) {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error("未找到 API Key(需要环境变量 ANTHROPIC_AUTH_TOKEN 或 ANTHROPIC_API_KEY)");
  }
  const model = resolveModel();
  if (!model) throw new Error("未解析到模型名(检查环境变量 ANTHROPIC_MODEL)");
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("文案不能为空");

  const resp = await fetch(`${resolveBaseUrl()}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      temperature: 0.7,
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: buildUserPrompt(trimmed) }],
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`LLM API ${resp.status}: ${errBody.slice(0, 500)}`);
  }

  const json = await resp.json();
  const full = (json.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!full) throw new Error("模型返回了空内容");

  return { model, deck: parseDeckJson(full) };
}
