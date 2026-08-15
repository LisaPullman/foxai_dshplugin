/**
 * FAL AI 调用封装 —— 用官方 SDK(已支持订阅式队列更新)。
 * - config({ credentials }) 注入 Key
 * - storage.upload(blob) 上传参考图(本地路径或 http URL 直接用,无需上传)
 * - subscribe(endpoint, { input, onQueueUpdate, logs }) 走完 submit/status/result
 *
 * 产物字段约定:fal 端点返回 { images:[{url,...}] } 或 { video:{url} } 或 { audio_url } /
 *   { audio:{url} } 等。这里做一层宽容归一化,统一抽出 [{ url, content_type, ext }]。
 */
import { fal } from "@fal-ai/client";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

export function configureFal(key) {
  fal.config({ credentials: key });
}

/** 把本地文件上传到 fal storage,返回 https URL。http(s) URL 原样返回。 */
export async function toFalUrl(maybePathOrUrl) {
  if (/^https?:\/\//i.test(maybePathOrUrl)) return maybePathOrUrl;
  const buf = readFileSync(maybePathOrUrl);
  const blob = new Blob([buf]);
  const ext = (extname(maybePathOrUrl) || ".bin").slice(1).toLowerCase();
  const file = new File([blob], basename(maybePathOrUrl), {
    type: mimeFromExt(ext),
  });
  const url = await fal.storage.upload(file);
  return url;
}

/**
 * 订阅式调用:返回归一化后的产物列表 [{ url, contentType, ext }]。
 * onLog/onProgress 用于把队列日志/进度透传给上层(SSE)。
 */
export async function callFal(endpointId, input, { onLog, onProgress } = {}) {
  const logs = [];
  const result = await fal.subscribe(endpointId, {
    input,
    logs: true,
    onQueueUpdate(update) {
      if (update.status === "IN_PROGRESS" && update.logs) {
        for (const l of update.logs) {
          logs.push(l);
          onLog?.(l);
        }
      }
      onProgress?.(update);
    },
  });

  const data = result?.data ?? result ?? {};
  const items = normalizeOutputs(data);

  if (items.length === 0) {
    // 把 data 原始结构也带上,便于调试
    throw new Error(
      `fal 端点 ${endpointId} 未返回可识别的产物。原始 data: ${JSON.stringify(
        data
      ).slice(0, 500)}`
    );
  }
  return { items, data, logs };
}

/** 归一化各种 fal 返回结构 → 产物列表 */
function normalizeOutputs(data) {
  const items = [];

  // 1) { images: [{url, content_type, ...}] }
  if (Array.isArray(data.images)) {
    for (const it of data.images) {
      if (it?.url) items.push(fromItem(it));
    }
  }

  // 2) { video: {url, content_type} } 或 { video_url }
  const v = data.video ?? data.video_url;
  if (typeof v === "string") items.push(fromUrl(v, "video/mp4", ".mp4"));
  else if (v?.url) items.push(fromItem(v, "video"));

  // 3) { audio: {...} | audio_url | audio_file_url }
  const a = data.audio ?? data.audio_url ?? data.audio_file_url;
  if (typeof a === "string") items.push(fromUrl(a, "audio/mpeg", ".mp3"));
  else if (a?.url) items.push(fromItem(a, "audio"));

  // 4) { output: { url } } / { output_url }
  const o = data.output ?? data.output_url;
  if (typeof o === "string") items.push(fromUrl(o));
  else if (o?.url) items.push(fromItem(o));

  return items;
}

function fromItem(it, kind) {
  const url = it.url;
  const ct = it.content_type || guessTypeFromUrl(url, kind);
  return { url, contentType: ct, ext: extFromMime(ct) || ".bin" };
}

function fromUrl(url, fallbackType = "image/png", fallbackExt = ".png") {
  const ct = guessTypeFromUrl(url) || fallbackType;
  return { url, contentType: ct, ext: extFromMime(ct) || fallbackExt };
}

function guessTypeFromUrl(url, kind) {
  const lower = String(url).toLowerCase();
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".jpg") || lower.includes(".jpeg")) return "image/jpeg";
  if (lower.includes(".webp")) return "image/webp";
  if (lower.includes(".mp4")) return "video/mp4";
  if (lower.includes(".webm")) return "video/webm";
  if (lower.includes(".mov")) return "video/quicktime";
  if (lower.includes(".mp3")) return "audio/mpeg";
  if (lower.includes(".wav")) return "audio/wav";
  if (kind === "video") return "video/mp4";
  if (kind === "audio") return "audio/mpeg";
  return null;
}

function extFromMime(mime) {
  if (!mime) return null;
  const map = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/mp4": ".m4a",
  };
  return map[mime] ?? null;
}

function mimeFromExt(ext) {
  const map = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
  };
  return map[ext] ?? "application/octet-stream";
}