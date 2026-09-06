#!/usr/bin/env node
// =============================================================
// foxai_update — CC Switch 环境变量恢复器（跨平台）
//
// 职责：升级完 AI CLI 工具（特别是 claude-code）后，
//   从 ~/.cc-switch/cc-switch.db 读取 is_current=1 的 provider profile，
//   把它的 env 段覆盖写回到 ~/.claude/settings.json 等目标文件。
//
// 调用方式：
//   const restore = require('./cc-switch-restore.js')
//   const result = restore.restoreForApp('claude')   // → { ok, provider, envKeys, written, path }
//   const all = restore.restoreAll()                  // → { claude: {...}, codex: {...}, ... }
//
// 跨平台：
//   - macOS/Linux:  ~/.cc-switch/cc-switch.db     ~/.claude/settings.json
//   - Windows:      %USERPROFILE%\.cc-switch\...  %USERPROFILE%\.claude\settings.json
//   - Linux/无 sqlite3 CLI：返回 'no-sqlite3' 错误（不 throw，让上层降级）
//
// 安全策略：
//   - 仅在 DB 中明确找到 is_current=1 时才写文件；
//     找不到或解析失败 → 返回 ok=false, status=skipped，不动磁盘。
//   - 写入前备份原文件为 <path>.foxup-backup-<ISO>，
//     让用户能手工回滚。
//   - 保留原 settings.json 中已有的 "permissions"、"mcpServers" 等其他顶层 key，
//     只覆盖/新增 "env" 段。
// =============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const IS_WIN = process.platform === 'win32';

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

// 每个 app_type 的 DB key 与目标配置文件路径
const APP_TARGETS = {
  claude: {
    dbApp: 'claude',
    targetRel: '.claude/settings.json',
    parseFromDbRow: parseClaudeRow,
    writeMode: 'json',  // 用通用 JSON 合并 env 段
  },
  codex: {
    dbApp: 'codex',
    targetRel: '.codex/auth.json',
    parseFromDbRow: parseCodexRow,
    writeMode: 'json',
  },
  opencode: {
    dbApp: 'opencode',
    targetRel: '.config/opencode/opencode.json',
    parseFromDbRow: parseOpencodeRow,
    writeMode: 'json',
  },
  gemini: {
    dbApp: 'gemini',
    targetRel: '.gemini/settings.json',
    parseFromDbRow: parseGeminiRow,
    writeMode: 'json',
  },
  pi: {
    dbApp: 'pi',
    targetRel: '.pi/settings.json',
    parseFromDbRow: parsePiRow,
    writeMode: 'json',
  },
};

// 找到 CC Switch 的 DB 路径（macOS/Linux/Windows 都覆盖）
function ccSwitchDbPath() {
  const root = IS_WIN
    ? path.join(process.env.APPDATA || path.join(homeDir(), 'AppData', 'Roaming'))
    : homeDir();
  return path.join(root, '.cc-switch', 'cc-switch.db');
}

// 在 PATH 上找 sqlite3
function findSqlite3() {
  if (IS_WIN) {
    // Windows 通常无自带 sqlite3 CLI,需要返回 null 让上层降级
    const probe = spawnSync('where', ['sqlite3'], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout) return probe.stdout.split(/\r?\n/)[0].trim();
    return null;
  }
  const probe = spawnSync('which', ['sqlite3'], { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout) return probe.stdout.split(/\r?\n/)[0].trim();
  return null;
}

function queryCurrentProvider(sqlite3, dbPath, appType) {
  // -json 让 sqlite3 输出 JSON,程序侧 parse
  const sql = "SELECT id, name, settings_config FROM providers WHERE app_type='" +
    appType.replace(/'/g, "''") + "' AND is_current=1 LIMIT 1;";
  const res = spawnSync(sqlite3, ['-json', dbPath, sql], {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (res.error) return { ok: false, error: 'sqlite3 执行失败: ' + (res.error.message || res.error) };
  if (res.status !== 0) {
    return { ok: false, error: 'sqlite3 exit ' + res.status + ': ' + String(res.stderr || '').trim().slice(0, 300) };
  }
  const out = String(res.stdout || '').trim();
  if (!out) return { ok: true, row: null }; // 没找到 is_current=1
  let arr;
  try {
    arr = JSON.parse(out);
  } catch (e) {
    return { ok: false, error: 'sqlite3 输出无法 JSON.parse: ' + out.slice(0, 200) };
  }
  return { ok: true, row: Array.isArray(arr) && arr.length > 0 ? arr[0] : null };
}

// 把 ISO 时间戳做成安全的备份文件名后缀
function backupSuffix() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// 通用 JSON 设置文件读+merge env 段
function restoreJsonSettings(targetPath, envObj, extra) {
  // extra = { preserveKeys: ['tui','permissions',...] } 保留不覆盖
  extra = extra || {};
  let original = {};
  if (fs.existsSync(targetPath)) {
    try {
      original = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
      if (!original || typeof original !== 'object' || Array.isArray(original)) original = {};
    } catch (e) {
      // 原文件损坏 → 备份后重建
      const bak = targetPath + '.foxup-corrupt-' + backupSuffix();
      try { fs.copyFileSync(targetPath, bak); } catch (_) {}
      original = {};
    }
  }
  // 备份原文件
  if (fs.existsSync(targetPath)) {
    const bak = targetPath + '.foxup-backup-' + backupSuffix();
    try { fs.copyFileSync(targetPath, bak); } catch (_) { /* best effort */ }
  }
  const merged = Object.assign({}, original);
  merged.env = Object.assign({}, original.env || {}, envObj || {});
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return { path: targetPath, envKeys: Object.keys(envObj || {}).length };
}

function parseClaudeRow(row) {
  // settings_config: JSON 字符串,包含 env / hooks 等
  if (!row || !row.settings_config) return null;
  let cfg;
  try { cfg = JSON.parse(row.settings_config); } catch (_) { return null; }
  return cfg && cfg.env ? cfg.env : null;
}

function parseCodexRow(row) {
  // codex 的 settings_config 结构:
  //   旧版: { apiKey, baseUrl, wireApi, envKey } — 单一 provider
  //   新版: { auth: { OPENAI_API_KEY, auth_mode, ... }, config: "<TOML 串>" }
  // 两种我们都尝试解析,把 key 转成 OPENAI_* 标准 env 写回 ~/.codex/auth.json
  if (!row || !row.settings_config) return null;
  let cfg;
  try { cfg = JSON.parse(row.settings_config); } catch (_) { return null; }
  const env = {};
  if (cfg && typeof cfg === 'object') {
    // 新 schema: auth.OPENAI_API_KEY
    if (cfg.auth && typeof cfg.auth === 'object') {
      if (cfg.auth.OPENAI_API_KEY) env.OPENAI_API_KEY = cfg.auth.OPENAI_API_KEY;
      if (cfg.auth.OPENAI_BASE_URL) env.OPENAI_BASE_URL = cfg.auth.OPENAI_BASE_URL;
    }
    // 旧 schema
    if (cfg.apiKey) env.OPENAI_API_KEY = cfg.apiKey;
    if (cfg.baseUrl) env.OPENAI_BASE_URL = cfg.baseUrl;
    // Zhipu/GLM 等走本地代理,这里不必写 base_url(由 config.toml 维护)
  }
  return Object.keys(env).length > 0 ? env : null;
}

function parseOpencodeRow(row) {
  if (!row || !row.settings_config) return null;
  let cfg;
  try { cfg = JSON.parse(row.settings_config); } catch (_) { return null; }
  return cfg && cfg.env ? cfg.env : null;
}

function parseGeminiRow(row) {
  if (!row || !row.settings_config) return null;
  let cfg;
  try { cfg = JSON.parse(row.settings_config); } catch (_) { return null; }
  return cfg && cfg.env ? cfg.env : null;
}

function parsePiRow(row) {
  if (!row || !row.settings_config) return null;
  let cfg;
  try { cfg = JSON.parse(row.settings_config); } catch (_) { return null; }
  return cfg && cfg.env ? cfg.env : null;
}

// 单 app 恢复入口
function restoreForApp(appId) {
  const cfg = APP_TARGETS[appId];
  if (!cfg) return { app: appId, ok: false, status: 'unsupported', error: 'unknown app id: ' + appId };

  const sqlite3 = findSqlite3();
  if (!sqlite3) {
    return { app: appId, ok: false, status: 'no-sqlite3', error: '未找到 sqlite3 CLI,跳过恢复' };
  }
  const dbPath = ccSwitchDbPath();
  if (!fs.existsSync(dbPath)) {
    return { app: appId, ok: false, status: 'no-db', error: '未发现 CC Switch 数据库: ' + dbPath };
  }

  const q = queryCurrentProvider(sqlite3, dbPath, cfg.dbApp);
  if (!q.ok) return { app: appId, ok: false, status: 'db-error', error: q.error };

  if (!q.row) {
    return {
      app: appId,
      ok: true,
      status: 'skipped',
      provider: null,
      envKeys: 0,
      message: 'CC Switch 中无 is_current=1 的 ' + cfg.dbApp + ' provider,跳过',
    };
  }

  const envObj = cfg.parseFromDbRow(q.row);
  if (!envObj) {
    // 没有 env 段是合法情况:例如 OpenAI Official profile 走 ChatGPT 登录态,
    // 或本地代理模式下不需要环境变量。这里当作 "skipped" 而非 error。
    return {
      app: appId,
      ok: true,
      status: 'skipped',
      provider: q.row.name,
      envKeys: 0,
      message: 'CC Switch provider「' + q.row.name + '」无 env 段（可能用 OAuth / 本地代理），跳过',
    };
  }

  const target = path.join(homeDir(), cfg.targetRel);
  let writeResult;
  try {
    // 所有 CLI 配置文件都按 JSON 处理(env 是子段;codex 已是 ~/.codex/auth.json)
    writeResult = restoreJsonSettings(target, envObj);
  } catch (e) {
    return {
      app: appId,
      ok: false,
      status: 'write-error',
      provider: q.row.name,
      error: '写入失败: ' + String((e && e.message) || e),
    };
  }

  return {
    app: appId,
    ok: true,
    status: 'restored',
    provider: q.row.name,
    providerId: q.row.id,
    path: writeResult.path,
    envKeys: writeResult.envKeys,
    message: '已从 CC Switch provider「' + q.row.name + '」恢复 ' + writeResult.envKeys + ' 个环境变量',
  };
}

function restoreAll(onlyApps) {
  const apps = onlyApps && onlyApps.length > 0 ? onlyApps : Object.keys(APP_TARGETS);
  const out = {};
  for (const app of apps) {
    try {
      out[app] = restoreForApp(app);
    } catch (e) {
      out[app] = { app: app, ok: false, status: 'exception', error: String((e && e.message) || e) };
    }
  }
  return out;
}

module.exports = {
  restoreForApp: restoreForApp,
  restoreAll: restoreAll,
  ccSwitchDbPath: ccSwitchDbPath,
  findSqlite3: findSqlite3,
};
