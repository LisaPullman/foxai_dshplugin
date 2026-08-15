/**
 * 统一生成流程 —— 解析参数 → 调 fal → 下载产物到「完成档」→ 命名规则。
 * 命名:{模型id去斜杠}-{YYYYMMDD}-{HHmm}[-{序号}].{ext}
 * 例:fal-ai-nano-banana-2-20260815-2030.png
 */
import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";

import {
  getOutputsDir,
  getReferencesDir,
  loadFalKey,
} from "./env.js";
import { findModel, buildInput } from "./registry.js";
import { configureFal, callFal, toFalUrl } from "./fal.js";

const SAFE_SLUG = (id) => id.replace(/[^a-zA-Z0-9_-]/g, "-");

function pad(n) {
  return String(n).padStart(2, "0");
}

function timestampNow() {
  const d = new Date();
  return {
    date: `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`,
    time: `${pad(d.getHours())}${pad(d.getMinutes())}`,
  };
}

/**
 * 解析参考图输入,统一为 fal https URL 数组。
 * 接受:
 *   - "参考图/xxx.png"  (相对插件目录)
 *   - "/abs/path/xxx.png"
 *   - "https://..."
 */
export async function resolveReferenceImages(input) {
  if (!Array.isArray(input)) input = input ? [input] : [];
  const refsDir = getReferencesDir();
  const out = [];
  for (const r of input) {
    if (!r) continue;
    if (/^https?:\/\//i.test(r)) {
      out.push(r);
      continue;
    }
    const abs = r.startsWith("/") ? r : join(refsDir, r);
    if (!existsSync(abs)) {
      throw new Error(
        `参考图不存在:${abs}(参考图文件夹:${refsDir})`
      );
    }
    out.push(await toFalUrl(abs));
  }
  return out;
}

async function downloadToFile(url, filePath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `下载产物失败 ${url} → ${res.status} ${res.statusText}`
    );
  }
  // Node 26 支持 arrayBuffer,直接落盘
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(filePath, buf);
}

/**
 * 主入口:执行一次生成。
 * opts = {
 *   model, prompt, referenceImages, aspectRatio, numImages, duration, extraInput,
 *   onLog?(line), onProgress?(status)
 * }
 * 返回 { files: [{ path, url, mime, size }], logs }
 */
export async function generate(opts) {
  const key = loadFalKey();
  if (!key) {
    throw new Error(
      "FAL_KEY 未配置。请在插件根目录的 .env 文件中填写 FAL_KEY=...(.env.example 可作为模板)。"
    );
  }
  configureFal(key);

  const model = findModel(opts.model);
  if (!model) throw new Error(`未知模型:${opts.model}`);

  const refs = await resolveReferenceImages(opts.referenceImages);
  const input = buildInput(model, {
    prompt: opts.prompt,
    referenceImages: refs,
    aspectRatio: opts.aspectRatio ?? "16:9",
    numImages: opts.numImages ?? 1,
    duration: opts.duration,
    extraInput: opts.extraInput ?? {},
  });

  // 调用 fal
  const { items, logs } = await callFal(model.id, input, {
    onLog: opts.onLog,
    onProgress: opts.onProgress,
  });

  // 下载到「完成档」
  const outDir = getOutputsDir();
  mkdirSync(outDir, { recursive: true });
  const { date, time } = timestampNow();
  const baseSlug = SAFE_SLUG(model.id);
  const files = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const seq = items.length > 1 ? `-${i + 1}` : "";
    const fileName = `${baseSlug}-${date}-${time}${seq}${item.ext}`;
    const filePath = join(outDir, fileName);
    await downloadToFile(item.url, filePath);
    files.push({
      path: filePath,
      fileName,
      mime: item.contentType,
      ext: item.ext,
      sourceUrl: item.url,
    });
  }

  return { files, logs, model: model.id };
}