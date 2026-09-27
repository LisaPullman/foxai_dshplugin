#!/usr/bin/env node
// =============================================================
// foxai_update — CC Switch 全局代理配置器（跨平台）
//
// 背景：参见仓库根 CC-Switch路由配置.md。本机链路：
//   [Codex/Claude CLI] → CC Switch 本地代理(15721) → 出站代理(global_proxy_url)
//                       → xray(10808) → 上游 OpenAI/Anthropic
// 2026-09-27 504 事故即因 settings 表无 global_proxy_url 行 → 裸直连被 TLS 黑。
//
// 调用方式：
//   const setup = require('./cc-switch-proxy-setup.js')
//   setup.status()                         // 检查当前是否已配
//   setup.apply({ proxyUrl })              // 备份 + 写 DB + 重启 CC Switch
//   setup.rollback({ fromBackupPath })    // 回滚到指定备份
//   setup.verify()                         // 跑 §5 四条验证（只读）
//
// CLI（无需参数即 apply 默认 socks5://127.0.0.1:10808）：
//   node cc-switch-proxy-setup.js apply [--proxy-url <url>]
//   node cc-switch-proxy-setup.js status
//   node cc-switch-proxy-setup.js rollback <backup-db-path>
//   node cc-switch-proxy-setup.js verify
//   node cc-switch-proxy-setup.js xray-up   // 拉起 v2rayN bin/xray（仅 macOS）
//   node cc-switch-proxy-setup.js help
//
// 跨平台：
//   - macOS/Linux:  ~/.cc-switch/cc-switch.db  ~/.cc-switch/logs/cc-switch.log
//                   重启用 lsof / open -a
//   - Windows:      %USERPROFILE%\.cc-switch\cc-switch.db
//                   重启用 netstat -ano / taskkill + 应用 bundle 路径
//
// 安全策略：
//   - 写 DB 前必备份到 ~/.cc-switch/backups/cc-switch.db.pre-proxy-fix-<TS>
//   - 写完只打印 key 与 value 长度，不打印 value（避免凭据泄漏）
//   - 失败任一步不丢已完成的：备份已完成则保留，回滚靠备份文件
// =============================================================

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function v2raynDir() {
  // v2rayN 配置目录（macOS）
  return path.join(homeDir(), 'Library', 'Application Support', 'v2rayN');
}

function ccSwitchHome() {
  return path.join(homeDir(), '.cc-switch');
}

function ccSwitchDbPath() {
  return path.join(ccSwitchHome(), 'cc-switch.db');
}

function ccSwitchLogPath() {
  return path.join(ccSwitchHome(), 'logs', 'cc-switch.log');
}

function backupsDir() {
  const d = path.join(ccSwitchHome(), 'backups');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function findSqlite3() {
  if (IS_WIN) {
    const p = spawnSync('where', ['sqlite3'], { encoding: 'utf8' });
    return p.status === 0 && p.stdout ? p.stdout.split(/\r?\n/)[0].trim() : null;
  }
  const p = spawnSync('which', ['sqlite3'], { encoding: 'utf8' });
  return p.status === 0 && p.stdout ? p.stdout.split(/\r?\n/)[0].trim() : null;
}

function ccSwitchAppPath() {
  // 优先列 /Applications；找不到再降级到常见路径
  const candidates = IS_WIN
    ? [
        // Windows 上由用户安装，默认无固定路径，让调用方传
      ]
    : IS_MAC
      ? [
          '/Applications/CC Switch.app/Contents/MacOS/cc-switch',
          '/Applications/CC-Switch.app/Contents/MacOS/cc-switch',
        ]
      : [
          '/usr/local/bin/cc-switch',
          '/opt/cc-switch/bin/cc-switch',
        ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function ccSwitchPortListening(port) {
  // 跨平台端口监听探测
  if (IS_WIN) {
    const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
    return String(r.stdout || '').split(/\r?\n/).some(l => l.includes(`:${port}`) && l.includes('LISTENING'));
  }
  const r = spawnSync('lsof', ['-iTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout && r.stdout.trim().length > 0;
}

function portFree(port) {
  return !ccSwitchPortListening(port);
}

function waitFor(predicate, timeoutMs, label) {
  const step = 250;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    // 新版 Node 没有 Atomics.wait 同步睡眠；用 setTimeout promise
  }
  return predicate();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForAsync(predicate, timeoutMs, label) {
  const step = 200;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(step);
  }
  return predicate();
}

function killCcSwitch(port) {
  // 通过 15721 端口反查 PID（更稳，按端口不按 process name）
  let pids;
  if (IS_WIN) {
    const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
    const lines = String(r.stdout || '').split(/\r?\n/);
    pids = [];
    for (const l of lines) {
      if (l.includes(`:${port}`) && l.includes('LISTENING')) {
        const m = l.trim().split(/\s+/);
        const pid = m[m.length - 1];
        if (pid && /^\d+$/.test(pid)) pids.push(pid);
      }
    }
  } else {
    const r = spawnSync('lsof', ['-iTCP:' + port, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
    pids = String(r.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }
  if (pids.length === 0) return { ok: true, killed: 0 };
  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGTERM');
    } catch (e) { /* best effort */ }
  }
  return { ok: true, killed: pids.length, pids };
}

function launchCcSwitch(appPath) {
  if (IS_MAC) {
    // 通过 `open` 启动 app bundle；只要给到 .app 的路径，open 会自动定位可执行
    const appBundle = appPath.includes('.app/Contents/MacOS')
      ? appPath.substring(0, appPath.indexOf('.app/') + 4)
      : path.dirname(path.dirname(path.dirname(appPath)));
    const r = spawnSync('open', [appBundle], { encoding: 'utf8', detached: true });
    return { ok: r.status === 0, stderr: String(r.stderr || '').trim() };
  }
  if (IS_WIN) {
    const r = spawnSync('cmd', ['/c', 'start', '""', appPath], { encoding: 'utf8', detached: true });
    return { ok: r.status === 0 };
  }
  const r = spawnSync(appPath, [], { encoding: 'utf8', detached: true });
  return { ok: r.status === 0 };
}

async function restartCcSwitch({ port = 15721, appPath } = {}) {
  if (!appPath) appPath = ccSwitchAppPath();
  if (!appPath) {
    return { ok: false, error: '找不到 CC Switch 可执行路径，请用 --app-path 指定' };
  }
  console.log('[1/3] kill 老进程（按端口 ' + port + '）…');
  const k = killCcSwitch(port);
  if (k.error) return { ok: false, error: k.error };
  console.log('      killed=' + k.killed);

  console.log('[2/3] 等端口释放…');
  const freed = await waitForAsync(() => portFree(port), 10000, 'port-free');
  if (!freed) return { ok: false, error: '端口 ' + port + ' 10s 内未释放' };
  console.log('      ✓ port free');

  console.log('[3/3] 拉起新进程…');
  const launched = launchCcSwitch(appPath);
  if (!launched.ok) {
    return { ok: false, error: '启动失败: ' + (launched.stderr || 'unknown') };
  }
  const listened = await waitForAsync(() => ccSwitchPortListening(port), 15000, 'port-listen');
  if (!listened) return { ok: false, error: '新进程 15s 内未监听 ' + port };
  console.log('      ✓ port listening again');
  return { ok: true, killed: k.killed };
}

// ---------- DB 操作 ----------

function backupDb(dbPath) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(backupsDir(), 'cc-switch.db.pre-proxy-fix-' + ts);
  fs.copyFileSync(dbPath, dest);
  return dest;
}

function readGlobalProxyUrlLength(sqlite3, dbPath) {
  // 不打印 value，只打印 length 与是否存在
  const r = spawnSync(sqlite3, ['-json', dbPath,
    "SELECT key, length(value) AS v_len FROM settings WHERE key='global_proxy_url';"],
    { encoding: 'utf8', timeout: 30000 });
  if (r.error) return { ok: false, error: r.error.message };
  if (r.status !== 0) return { ok: false, error: 'sqlite3 exit ' + r.status + ': ' + String(r.stderr || '').trim().slice(0, 300) };
  const arr = JSON.parse(String(r.stdout || '[]').trim() || '[]');
  if (!arr.length) return { ok: true, exists: false };
  return { ok: true, exists: true, vLen: arr[0].v_len };
}

function writeGlobalProxyUrl(sqlite3, dbPath, proxyUrl) {
  // 用 INSERT OR REPLACE（key 是 PRIMARY KEY）
  const r = spawnSync(sqlite3, [dbPath,
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('global_proxy_url', '"
    + proxyUrl.replace(/'/g, "''") + "');"],
    { encoding: 'utf8', timeout: 30000 });
  if (r.error) return { ok: false, error: r.error.message };
  if (r.status !== 0) return { ok: false, error: 'sqlite3 exit ' + r.status + ': ' + String(r.stderr || '').trim().slice(0, 300) };
  return { ok: true };
}

// ---------- Public API ----------

function status(opts) {
  opts = opts || {};
  const dbPath = opts.dbPath || ccSwitchDbPath();
  const sqlite3 = findSqlite3();
  if (!sqlite3) return { ok: false, error: '缺少 sqlite3 CLI（macOS: brew install sqlite3；Windows: 暂不支持）' };
  if (!fs.existsSync(dbPath)) return { ok: false, error: 'DB 不存在: ' + dbPath };

  const proxyLen = readGlobalProxyUrlLength(sqlite3, dbPath);
  const port15721 = ccSwitchPortListening(15721);
  const port10808 = ccSwitchPortListening(10808);

  // 拉一条最新的 [GlobalProxy] 日志（仅元信息，不打印 value）
  let lastLog = '';
  const logPath = ccSwitchLogPath();
  if (fs.existsSync(logPath)) {
    const txt = fs.readFileSync(logPath, 'utf8');
    const lines = txt.split(/\r?\n/).filter(l => l.includes('[GlobalProxy]'));
    lastLog = lines.length ? lines[lines.length - 1] : '';
  }

  return {
    ok: true,
    db: dbPath,
    global_proxy_url: proxyLen.ok ? { exists: proxyLen.exists, value_len: proxyLen.vLen || null } : null,
    port15721_listening: port15721,
    port10808_listening: port10808,
    lastGlobalProxyLog: lastLog || '(none)',
  };
}

async function apply(opts) {
  opts = opts || {};
  const proxyUrl = opts.proxyUrl || 'socks5://127.0.0.1:10808';
  const dbPath = opts.dbPath || ccSwitchDbPath();
  const skipRestart = !!opts.skipRestart;
  const sqlite3 = findSqlite3();
  if (!sqlite3) return { ok: false, error: '缺少 sqlite3 CLI' };
  if (!fs.existsSync(dbPath)) return { ok: false, error: 'DB 不存在: ' + dbPath };

  console.log('== 0) 备份 DB ==');
  const backup = backupDb(dbPath);
  console.log('   → ' + backup);
  console.log('   （回滚用 rollback 子命令指向此路径）');

  console.log('== 1) 写 settings.global_proxy_url ==');
  const w = writeGlobalProxyUrl(sqlite3, dbPath, proxyUrl);
  if (!w.ok) return { ok: false, error: '写 DB 失败: ' + w.error, backup: backup };
  const chk = readGlobalProxyUrlLength(sqlite3, dbPath);
  console.log('   key=global_proxy_url  length=' + (chk.vLen || '?') + ' bytes（不回显 value）');

  if (skipRestart) {
    console.log('== 2) 跳过重启（skipRestart=true），请手工重启 CC Switch ==');
    return { ok: true, backup: backup, restarted: false };
  }

  console.log('== 2) 重启 CC Switch ==');
  const r = await restartCcSwitch({});
  if (!r.ok) return { ok: false, error: '重启失败: ' + r.error, backup: backup };

  console.log('== 3) 验证（仅打印，不改任何东西） ==');
  return await verify();
}

function rollback(opts) {
  opts = opts || {};
  if (!opts.fromBackupPath) return { ok: false, error: 'rollback 需指定 fromBackupPath' };
  if (!fs.existsSync(opts.fromBackupPath)) {
    return { ok: false, error: '备份不存在: ' + opts.fromBackupPath };
  }
  const dbPath = opts.dbPath || ccSwitchDbPath();
  // 备份当前 DB，万一 rollback 本身回滚错了还能救
  const safety = backupDb(dbPath);
  console.log('当前 DB 已另存为 ' + safety);
  fs.copyFileSync(opts.fromBackupPath, dbPath);
  console.log('已用 ' + opts.fromBackupPath + ' 覆盖 ' + dbPath);
  return { ok: true, safetyBackup: safety };
}

async function verify() {
  const s = status();
  if (!s.ok) return s;
  console.log('   settings.global_proxy_url: exists=' + s.global_proxy_url.exists +
              ', value_len=' + (s.global_proxy_url.value_len || 'n/a'));
  console.log('   15721 listening: ' + s.port15721_listening);
  console.log('   10808 listening: ' + s.port10808_listening);
  console.log('   last [GlobalProxy] log: ' + s.lastGlobalProxyLog);
  return s;
}

function xrayUp() {
  if (!IS_MAC) return { ok: false, error: 'xray-up 当前仅 macOS 实现' };
  const dir = v2raynDir();
  const xrayBin = path.join(dir, 'bin', 'xray', 'xray');
  const cfg = path.join(dir, 'binConfigs', 'config.json');
  const assets = path.join(dir, 'bin');
  if (!fs.existsSync(xrayBin)) return { ok: false, error: '找不到 xray: ' + xrayBin };
  if (!fs.existsSync(cfg)) return { ok: false, error: '找不到 config.json: ' + cfg };
  // 先看 10808 是否已被占用
  if (ccSwitchPortListening(10808)) {
    return { ok: false, error: '10808 已被占用，请先 kill 老 xray' };
  }
  const env = Object.assign({}, process.env, { XRAY_LOCATION_ASSET: assets });
  const r = spawnSync(xrayBin, ['run', '-c', cfg], {
    encoding: 'utf8',
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: env,
  });
  return { ok: true, pid: r.pid, note: '已 detach，10808 监听请另开 verify' };
}

// ---------- CLI 入口 ----------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--proxy-url' || a === '--proxy') {
      out.proxyUrl = argv[++i];
    } else if (a === '--app-path') {
      out.appPath = argv[++i];
    } else if (a === '--db-path') {
      out.dbPath = argv[++i];
    } else if (a === '--skip-restart') {
      out.skipRestart = true;
    } else if (a === '--from-backup') {
      out.fromBackupPath = argv[++i];
    } else if (a === '-h' || a === '--help') {
      out.help = true;
    } else if (!a.startsWith('-')) {
      out._.push(a);
    } else {
      out._.push(a); // 透传
    }
  }
  return out;
}

function helpText() {
  return [
    '用法:',
    '  node cc-switch-proxy-setup.js apply [--proxy-url <url>] [--skip-restart]',
    '  node cc-switch-proxy-setup.js status',
    '  node cc-switch-proxy-setup.js rollback --from-backup <path>',
    '  node cc-switch-proxy-setup.js verify',
    '  node cc-switch-proxy-setup.js xray-up',
    '  node cc-switch-proxy-setup.js help',
    '',
    '默认 proxy URL: socks5://127.0.0.1:10808',
    '回滚示例:',
    '  node cc-switch-proxy-setup.js rollback --from-backup ~/.cc-switch/backups/cc-switch.db.pre-proxy-fix-2026-09-27T19-27-07',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args._.length === 0) {
    console.log(helpText());
    return;
  }
  const cmd = args._[0];
  if (cmd === 'apply') {
    const r = await apply({
      proxyUrl: args.proxyUrl,
      dbPath: args.dbPath,
      skipRestart: args.skipRestart,
    });
    if (!r.ok) { console.error('FAIL: ' + r.error); process.exit(1); }
  } else if (cmd === 'status') {
    const r = status({ dbPath: args.dbPath });
    console.log(JSON.stringify(r, null, 2));
  } else if (cmd === 'rollback') {
    const r = rollback({ fromBackupPath: args.fromBackupPath, dbPath: args.dbPath });
    if (!r.ok) { console.error('FAIL: ' + r.error); process.exit(1); }
    console.log(JSON.stringify(r, null, 2));
  } else if (cmd === 'verify') {
    const r = await verify();
    console.log(JSON.stringify(r, null, 2));
  } else if (cmd === 'xray-up') {
    const r = xrayUp();
    if (!r.ok) { console.error('FAIL: ' + r.error); process.exit(1); }
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.error('未知子命令: ' + cmd);
    console.log(helpText());
    process.exit(2);
  }
}

if (require.main === module) {
  main().catch(e => { console.error('未捕获异常: ' + (e.stack || e.message || e)); process.exit(1); });
}

module.exports = {
  apply,
  rollback,
  status,
  verify,
  xrayUp,
  restartCcSwitch,
  ccSwitchAppPath,
  ccSwitchPortListening,
  // 工具函数，方便测试
  _internal: {
    backupDb,
    readGlobalProxyUrlLength,
    writeGlobalProxyUrl,
    findSqlite3,
    ccSwitchDbPath,
    ccSwitchLogPath,
    backupsDir,
  },
};
