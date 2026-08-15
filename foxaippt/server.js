/**
 * AI 网页 PPT 生成器 — 后端服务
 * Express 托管前端静态资源,并提供 /api/generate 流式代理:
 *   调用 DeepSeek(OpenAI 兼容协议,deepseek-v4-pro)将长文案拆解为 PPT JSON 结构,
 *   把模型的流式输出以 SSE 逐块转发给前端。
 */

import express from "express";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ---------- 配置 ----------
const BASE_URL = "https://api.deepseek.com/v1";
const MODEL = "deepseek-v4-pro";
const PORT = Number(process.env.PORT) || 8787;

// ---------- API Key 加载(本机) ----------
// 优先级:环境变量 DEEPSEEK_API_KEY > ~/.dsh/.credentials.yaml
function loadApiKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  const candidates = [
    join(homedir(), ".dsh", ".credentials.yaml"),
    join(homedir(), ".dsh", ".credentials.yml"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    const m = text.match(/DEEPSEEK_API_KEY\s*:\s*["']?(sk-[A-Za-z0-9]+)["']?/);
    if (m) return m[1];
  }
  return null;
}

const API_KEY = loadApiKey();

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

// ---------- DeepSeek 流式调用 ----------
/**
 * 调用 DeepSeek chat completions(stream=true),返回一个 async generator,
 * 逐块 yield 模型输出的文本增量。
 */
async function* streamDeepSeek(text, signal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(text) },
      ],
      stream: true,
      temperature: 0.7,
      response_format: { type: "json_object" },
    }),
    signal: controller.signal,
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`DeepSeek API ${resp.status}: ${errBody.slice(0, 500)}`);
  }

  const decoder = new TextDecoder();
  const reader = resp.body.getReader();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE 按行切分;每个 data: 行是 JSON chunk
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        let json;
        try {
          json = JSON.parse(payload);
        } catch {
          continue; // 忽略无法解析的行
        }
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

// ---------- Express 应用 ----------
const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(join(__dirname, "public")));

// 健康检查 / 元信息(不泄露 key)
app.get("/api/config", (_req, res) => {
  res.json({
    model: MODEL,
    baseUrl: BASE_URL,
    hasApiKey: Boolean(API_KEY),
  });
});

app.post("/api/generate", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) {
    return res.status(400).json({ error: "文案不能为空" });
  }
  if (!API_KEY) {
    return res.status(500).json({ error: "未找到 DeepSeek API Key(检查 ~/.dsh/.credentials.yaml 或环境变量 DEEPSEEK_API_KEY)" });
  }

  // SSE 响应头
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // 客户端中途断开时(响应尚未正常结束),中止上游 DeepSeek 请求
  const abort = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) abort.abort();
  };
  res.on("close", onClose);

  let full = "";
  try {
    send("meta", { model: MODEL });

    for await (const chunk of streamDeepSeek(text, abort.signal)) {
      full += chunk;
      // 逐块转发给前端(实时进度)
      send("delta", { text: chunk });
    }

    // 校验最终 JSON 是否可解析
    let parsed = null;
    let parseError = null;
    try {
      parsed = JSON.parse(full);
    } catch (e) {
      parseError = e.message;
      // 尝试剥离可能的 Markdown 代码块后重试
      const stripped = full.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
      try {
        parsed = JSON.parse(stripped);
        parseError = null;
        full = stripped;
      } catch {
        /* keep parseError */
      }
    }

    if (!parsed || !Array.isArray(parsed.slides)) {
      send("error", {
        message: parseError
          ? `模型输出无法解析为 JSON:${parseError}`
          : "模型输出缺少 slides 数组",
        raw: full.slice(0, 2000),
      });
    } else {
      send("done", { deck: parsed });
    }
  } catch (err) {
    send("error", { message: err.message || String(err) });
  } finally {
    res.off("close", onClose);
    res.end();
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`AI 网页 PPT 生成器已启动:http://127.0.0.1:${PORT}`);
  console.log(`模型:${MODEL}  API Key:${API_KEY ? "已就绪" : "缺失"}`);
});
