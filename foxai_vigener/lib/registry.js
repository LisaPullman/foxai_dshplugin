/**
 * 模型注册表 —— 合并 models.json(预设)与 models.local.json(用户自定义)。
 * 同 id 的条目:local 覆盖 preset。用户可借此扩展任意 fal 端点。
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PLUGIN_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const PRESET_PATH = join(PLUGIN_DIR, "models.json");
const LOCAL_PATH = join(PLUGIN_DIR, "models.local.json");

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`模型注册表解析失败 ${path}: ${err.message}`);
  }
}

function mergeIndex(items) {
  const byId = new Map();
  for (const m of items) {
    if (!m || typeof m.id !== "string" || !m.id) continue;
    if (!m.type) {
      throw new Error(`模型 ${m.id} 缺少 type 字段`);
    }
    byId.set(m.id, { ...byId.get(m.id), ...m });
  }
  return [...byId.values()];
}

let cached = null;

export function listModels() {
  if (cached) return cached;
  const preset = readJson(PRESET_PATH)?.models ?? [];
  const local = readJson(LOCAL_PATH)?.models ?? [];
  const merged = mergeIndex([...preset, ...local]);
  cached = Object.freeze(merged);
  return cached;
}

/** 强制重读(自定义模型 CRUD 后调用) */
export function reloadModels() {
  cached = null;
  return listModels();
}

export function findModel(id) {
  return listModels().find((m) => m.id === id) ?? null;
}

export function defaultsByType() {
  const out = {};
  for (const m of listModels()) {
    if (m.isDefault && !out[m.type]) out[m.type] = m.id;
  }
  return out;
}

/**
 * 把用户友好的输入(16:9 / numImages / duration)映射到模型实际的 fal 入参。
 * - aspectRatio 支持字符串 "16:9" 或 { param, map } 形式(模型不同映射也不同)
 * - numImages / duration 按 param 字段写入
 * - extraInput(任意对象)浅合并在最外层,用于 mask_url 等高级参数
 */
export function buildInput(model, opts) {
  const input = {};
  const {
    prompt,
    referenceImages = [],
    aspectRatio = "16:9",
    numImages = 1,
    duration,
    extraInput = {},
  } = opts;

  // prompt
  if (model.promptParam) {
    input[model.promptParam] = prompt;
  }

  // 参考图
  if (
    model.referenceImages?.param &&
    Array.isArray(referenceImages) &&
    referenceImages.length > 0
  ) {
    const ref = model.referenceImages;
    input[ref.param] = ref.multiple ? referenceImages : referenceImages[0];
  }

  // 宽高比
  if (model.aspectRatio?.param && aspectRatio) {
    const ar = model.aspectRatio;
    if (ar.map && typeof ar.map === "object") {
      const mapped = ar.map[aspectRatio];
      if (mapped !== undefined) input[ar.param] = mapped;
    } else {
      input[ar.param] = aspectRatio;
    }
  }

  // 张数
  if (model.numImages?.param && Number.isFinite(numImages)) {
    input[model.numImages.param] = numImages;
  }

  // 时长(视频)
  if (model.duration?.param && duration !== undefined) {
    input[model.duration.param] = String(duration);
  }

  // 透传高级参数(可选 mask_url 等)
  Object.assign(input, extraInput);

  return input;
}