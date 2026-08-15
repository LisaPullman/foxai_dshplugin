/**
 * 环境加载 —— 读取插件自己的 .env(用户自填 FAL_KEY),process.env 优先。
 * 不引第三方 dotenv:本场景只需解析 KEY=VALUE 格式,自己写更轻。
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PLUGIN_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const ENV_PATH = join(PLUGIN_DIR, ".env");

let loaded = false;

function loadEnvFile() {
  if (loaded) return;
  loaded = true;
  if (!existsSync(ENV_PATH)) return;
  const text = readFileSync(ENV_PATH, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!m) continue;
    const [, key, valRaw] = m;
    let val = valRaw.trim();
    // 去掉首尾引号
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    // process.env 已有则不覆盖(更优先)
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

export function getPluginDir() {
  return PLUGIN_DIR;
}

export function getReferencesDir() {
  return join(PLUGIN_DIR, "参考图");
}

export function getOutputsDir() {
  return join(PLUGIN_DIR, "完成档");
}

export function loadFalKey() {
  loadEnvFile();
  const key = process.env.FAL_KEY;
  if (!key || key === "your-fal-key-here") return null;
  return key;
}

export function isConfigReady() {
  return Boolean(loadFalKey());
}