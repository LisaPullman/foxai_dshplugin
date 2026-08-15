/**
 * foxai_vigener Web 应用 —— Express 服务器,响应式前端托管 + REST API。
 *
 * 路由:
 *   GET  /api/config           FAL_KEY 状态、注册表统计
 *   GET  /api/models           注册表(分组 + 默认)
 *   GET  /api/references       「参考图」文件夹下的文件清单
 *   POST /api/references       上传一张参考图(multipart/form-data,字段 file)
 *   POST /api/generate         生成(SSE 进度:progress / log / done / error)
 *   GET  /api/outputs          「完成档」清单(按时间倒序)
 *   GET  /outputs/<name>       静态托管完成档
 *
 * 端口:8788(可由 PORT 覆盖)
 */
import express from "express";
import multer from "multer";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";

import { isConfigReady, getReferencesDir, getOutputsDir, getPluginDir } from "./lib/env.js";
import { listModels, defaultsByType, findModel, reloadModels } from "./lib/registry.js";
import { generate } from "./lib/generate.js";

const PORT = Number(process.env.PORT) || 8788;
const PLUGIN_DIR = getPluginDir();

const app = express();
app.use(express.json({ limit: "2mb" }));

// 静态托管前端
app.use(express.static(join(PLUGIN_DIR, "public")));
// 静态托管完成档
app.use(
  "/outputs",
  express.static(getOutputsDir(), {
    setHeaders(res, p) {
      const ext = extname(p).toLowerCase();
      const mime = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".m4a": "audio/mp4",
      }[ext];
      if (mime) res.setHeader("Content-Type", mime);
    },
  })
);

// multer 上传到内存,自己写到「参考图」文件夹
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// --- GET /api/config ---
app.get("/api/config", (_req, res) => {
  res.json({
    hasFalKey: isConfigReady(),
    modelCount: listModels().length,
    defaults: defaultsByType(),
    referencesDir: getReferencesDir(),
    outputsDir: getOutputsDir(),
  });
});

// --- GET /api/models ---
app.get("/api/models", (_req, res) => {
  const models = listModels();
  const grouped = {};
  for (const m of models) {
    (grouped[m.type] ??= []).push(m);
  }
  res.json({ count: models.length, grouped, defaults: defaultsByType() });
});

// --- 自定义模型 CRUD(写入 models.local.json) ---
const CUSTOM_PATH = join(PLUGIN_DIR, "models.local.json");

function readCustomModels() {
  if (!existsSync(CUSTOM_PATH)) return [];
  try {
    const j = JSON.parse(readFileSync(CUSTOM_PATH, "utf8"));
    return Array.isArray(j?.models) ? j.models : [];
  } catch {
    return [];
  }
}

function writeCustomModels(items) {
  writeFileSync(CUSTOM_PATH, JSON.stringify({ models: items }, null, 2) + "\n", "utf8");
}

// 校验自定义模型条目(最小必要字段)
function validateCustomModel(m) {
  if (!m || typeof m !== "object") throw new Error("条目必须是对象");
  if (!m.id || typeof m.id !== "string") throw new Error("缺少 id 字段");
  if (!m.label || typeof m.label !== "string") throw new Error("缺少 label 字段");
  if (!m.type) throw new Error("缺少 type 字段");
  // 填充默认值
  m.kind ??= "text-to-image";
  m.isDefault ??= false;
  m.promptParam ??= "prompt";
  m.referenceImages ??= null;
  m.aspectRatio ??= null;
  m.numImages ??= null;
  m.duration ??= null;
  return m;
}

// GET /api/custom-models
app.get("/api/custom-models", (_req, res) => {
  res.json({ models: readCustomModels() });
});

// POST /api/custom-models { model: {...} } — upsert(同 id 覆盖)
app.post("/api/custom-models", (req, res) => {
  try {
    const incoming = validateCustomModel(req.body?.model);
    const items = readCustomModels();
    const idx = items.findIndex((m) => m.id === incoming.id);
    if (idx >= 0) items[idx] = incoming;
    else items.push(incoming);
    writeCustomModels(items);
    // 清掉 registry 的内存缓存,确保下次 list 看到新模型
    reloadModels();
    res.json({ ok: true, model: incoming, count: items.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/custom-models/:id
app.delete("/api/custom-models/:id", (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const items = readCustomModels();
  const next = items.filter((m) => m.id !== id);
  if (next.length === items.length) {
    return res.status(404).json({ error: `未找到自定义模型:${id}` });
  }
  writeCustomModels(next);
  reloadModels();
  res.json({ ok: true, removed: id, count: next.length });
});

// --- GET /api/references ---
app.get("/api/references", (_req, res) => {
  const dir = getReferencesDir();
  if (!existsSync(dir)) {
    return res.json({ files: [] });
  }
  const files = readdirSync(dir)
    .filter((n) => !n.startsWith(".") && statSync(join(dir, n)).isFile())
    .map((name) => {
      const st = statSync(join(dir, name));
      return { name, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  res.json({ files });
});

// --- POST /api/references ---
app.post("/api/references", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "缺少文件字段 file" });
  const dir = getReferencesDir();
  mkdirSync(dir, { recursive: true });
  const safe = basename(req.file.originalname).replace(/[^\w.\-]/g, "_");
  const target = join(dir, safe);
  await writeFile(target, req.file.buffer);
  res.json({ ok: true, name: safe, size: req.file.size });
});

// --- POST /api/generate (SSE) ---
app.post("/api/generate", async (req, res) => {
  if (!isConfigReady()) {
    return res
      .status(400)
      .json({ error: "FAL_KEY 未配置,请在插件根目录 .env 中设置" });
  }
  const body = req.body ?? {};
  const {
    model,
    prompt,
    referenceImages = [],
    aspectRatio = "16:9",
    numImages = 1,
    duration,
    extraInput,
  } = body;

  if (!model || !prompt) {
    return res.status(400).json({ error: "model 和 prompt 必填" });
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send("progress", { status: "starting", message: `开始调用模型 ${model}` });

  try {
    const result = await generate({
      model,
      prompt,
      referenceImages,
      aspectRatio,
      numImages,
      duration,
      extraInput,
      onLog(line) {
        send("log", line);
      },
      onProgress(update) {
        send("progress", {
          status: update.status,
          queuePosition: update.queue_position,
        });
      },
    });

    send("done", {
      model: result.model,
      files: result.files.map((f) => ({
        path: f.path,
        fileName: f.fileName,
        mime: f.mime,
        url: `/outputs/${encodeURIComponent(f.fileName)}`,
      })),
    });
  } catch (err) {
    send("error", { message: err.message ?? String(err) });
  } finally {
    res.end();
  }
});

// --- GET /api/outputs ---
app.get("/api/outputs", (_req, res) => {
  const dir = getOutputsDir();
  if (!existsSync(dir)) return res.json({ files: [] });
  const files = readdirSync(dir)
    .filter((n) => !n.startsWith(".") && statSync(join(dir, n)).isFile())
    .map((name) => {
      const st = statSync(join(dir, name));
      const ext = extname(name).toLowerCase();
      const kind =
        ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp" || ext === ".gif"
          ? "image"
          : ext === ".mp4" || ext === ".webm" || ext === ".mov"
          ? "video"
          : ext === ".mp3" || ext === ".wav" || ext === ".m4a"
          ? "audio"
          : "other";
      return {
        name,
        size: st.size,
        mtime: st.mtimeMs,
        kind,
        url: `/outputs/${encodeURIComponent(name)}`,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
  res.json({ files });
});

// 启动
app.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(
    `[foxai_vigener] Web 已启动 http://127.0.0.1:${PORT} falReady=${isConfigReady()}`
  );
});