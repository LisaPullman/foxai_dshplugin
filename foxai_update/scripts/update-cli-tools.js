#!/usr/bin/env node
// =============================================================
// foxai_update — AI CLI 编码工具 检查/安装/升级（跨平台：macOS / Linux / Windows）
// 管辖工具: claude code / codex cli / gemini cli / opencode / pi / dsh(deepseek harness)
//
// 用法:
//   node update-cli-tools.js                    检查并自动安装/升级到最新
//   node update-cli-tools.js --check            只检查报告，不做任何改动
//   node update-cli-tools.js --json             末尾追加 ##JSON## 行（供插件解析）
//   node update-cli-tools.js --only pi,claude   只处理指定子集
//   node update-cli-tools.js --no-restore       跳过 CC Switch 环境变量恢复
//   node update-cli-tools.js --launch-dsh-web   升级后确保 DSH web 在跑(没跑则启动)
//   node update-cli-tools.js --restart-dsh-web  DSH web 在跑则 kill 后重启(没跑则启动)
//
// 状态说明:
//   ok          已是最新
//   upgradable  可升级（--check 模式）
//   upgraded    已升级 / installed 已安装（执行模式）
//   installable 未安装，待安装（--check 模式）
//   external    二进制存在但非 npm 全局渠道（如 brew/scoop），跳过
//   unknown     无法查询 npm registry（多为网络问题）
//   error       安装/升级失败
//
// DSH web（`dsh web`，全局安装，默认 http://127.0.0.1:3080，可用环境变量
// DSH_WEB_URL 覆盖）在工具升级后接管其生命周期：--launch-dsh-web 未运行才
// 启动；--restart-dsh-web 已运行则先 kill 再重启；从 DSH GUI 内派生的会话
// 会自动跳过 kill 以免自杀；--check 模式只探活报告，不做任何改动。
// dsh 版本可能被 TOOLS 注册表里的 pin 字段锁定（兼容性回退），启动时用全局
// dsh 二进制而非 npx —— npx 每次从 registry 解析 latest，会绕开 pin。
//
// 升级后（仅对 upgraded/installed 项）会自动调用 cc-switch-restore ，
// 从 ~/.cc-switch/cc-switch.db 把当前激活 provider 的 env 段写回
// ~/.claude/settings.json 等目标文件，避免 claude 升级后环境变量丢失。
//
// 对 pi 还会额外扫描 ~/.pi/agent/npm/node_modules/ 下的 user extensions
// (pi-mcp-adapter / pi-subagents / pi-web-access / pi-wechat-assistant 等)，
// 升级时调 `pi update --all` 一并处理 pi 自身 + 所有 extensions。
//
// 退出码: 0 = 无失败项   1 = 存在 error 项   2 = 参数错误
// =============================================================

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const IS_WIN = process.platform === 'win32';

// CC Switch 环境变量恢复器（与本脚本解耦；缺 sqlite3 时安静降级）
let ccRestore = null;
try {
  ccRestore = require('./cc-switch-restore.js');
} catch (e) {
  // 模块加载失败不应阻断主流程；后续会在执行时再判断
}

// ---------- 工具注册表 ----------
const TOOLS = [
  { id: 'claude',   name: 'Claude Code', pkg: '@anthropic-ai/claude-code',      bin: 'claude' },
  { id: 'codex',    name: 'Codex CLI',   pkg: '@openai/codex',                  bin: 'codex' },
  { id: 'gemini',   name: 'Gemini CLI',  pkg: '@google/gemini-cli',             bin: 'gemini' },
  { id: 'opencode', name: 'OpenCode',    pkg: 'opencode-ai',                    bin: 'opencode' },
  { id: 'pi',       name: 'Pi',          pkg: '@earendil-works/pi-coding-agent', bin: 'pi' },
  { id: 'grok',     name: 'Grok CLI',    pkg: '@xai-official/grok',             bin: 'grok' },
  { id: 'dsh',      name: 'DeepSeek Harness', pkg: '@deepseek-ai/dsh',           bin: 'dsh',
    // 兼容性锁：0.1.2-rc.1 移除了 @deepseek-ai/dsh-settings 的 settingsNamespace
    // 导出，~/.dsh/profiles/web 的插件生态（@linxin666/dsh-web-ui-all@0.3.6 的
    // web-ui-settings 入口依赖它）尚未跟进，dsh web 会在 bind 端口后 2~8s 内
    // 崩溃（ERR_CONNECTION_REFUSED）。插件侧 latest(0.3.6) 即当前已装版本，无可
    // 升级项——在上游适配前锁在 0.1.1-rc.2（2026-09 验证可用）。插件生态追上后
    // 删除本 pin 字段即恢复追最新。
    pin: '0.1.1-rc.2' },
];

// ---------- 参数解析（兼容 node file.js 与 node -e SCRIPT -- … 两种运行方式） ----------
function parseArgs(argv) {
  const opts = { check: false, json: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') opts.check = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--only') {
      // 必须紧跟一个不以 -- 开头的值;否则视为语法错误(让 main 报错)
      const v = argv[i + 1];
      if (v && !v.startsWith('--')) { opts.only = v; i++; }
      else { opts.only = ''; }  // 空字符串:在 main 里被当作 unknown 处理
    } else if (a.indexOf('--only=') === 0) {
      opts.only = a.slice(7);
    }
  }
  return opts;
}
const OPTS = parseArgs(process.argv);
const CHECK_ONLY = OPTS.check;
const EMIT_JSON = OPTS.json;
const NO_RESTORE = process.argv.indexOf('--no-restore') !== -1;
const LAUNCH_DSH_WEB = process.argv.indexOf('--launch-dsh-web') !== -1;
const RESTART_DSH_WEB = process.argv.indexOf('--restart-dsh-web') !== -1;
const DSH_WEB_URL = process.env.DSH_WEB_URL || 'http://127.0.0.1:3080';
const DSH_WEB_HOST = (function () {
  try {
    const u = new URL(DSH_WEB_URL);
    return { host: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)) };
  } catch (e) { return { host: '127.0.0.1', port: 3080 }; }
})();
// 仅当 only 是字符串(可能为空)时建立 onlySet,null 表示未传 --only
const onlySet = OPTS.only === null ? null : OPTS.only.split(',').map(function (s) { return s.trim() });

function out(msg) { process.stdout.write(msg + '\n'); }

// ---------- 子进程工具 ----------
function run(cmd, args, timeoutMs) {
  return spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: IS_WIN, // Windows 下 npm/npm.cmd、全局二进制需要经 cmd 解析
    timeout: timeoutMs || 0,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function npm(args, timeoutMs) { return run('npm', args, timeoutMs); }

// ---------- 前置检查 ----------
function NPM_ROOT_OF() {
  const res = npm(['root', '-g'], 60000);
  if (res.error || res.status !== 0) return '';
  return String(res.stdout || '').trim().split('\n').pop().trim();
}

const NPM_ROOT = NPM_ROOT_OF();

// ---------- 版本探测 ----------
function installedVersion(pkgName) {
  try {
    const pj = path.join.apply(null, [NPM_ROOT].concat(pkgName.split('/'), ['package.json']));
    const v = JSON.parse(fs.readFileSync(pj, 'utf8')).version;
    return v ? String(v) : '';
  } catch (e) {
    return '';
  }
}

function latestVersion(pkgName) {
  const res = npm(['view', pkgName, 'version'], 90000);
  if (res.error || res.status !== 0) return '';
  const v = String(res.stdout || '').trim().split('\n').pop().trim();
  return v || '';
}

// 简易版本比较（覆盖本脚本用到的 x.y.z[-pre.n] 形态；非完整 semver）：
// 数字段按数值比；同 core 下无预发布 > 有预发布；预发布段数字 < 字母。
// 解析失败退化为字符串比较。返回 <0 / 0 / >0。
function verCmp(a, b) {
  if (a === b) return 0;
  const parse = function (v) {
    const m = String(v).trim().match(/^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?$/);
    if (!m) return null;
    return {
      core: m[1].split('.').map(Number),
      pre: m[2] ? m[2].split('.').map(function (s) { return /^\d+$/.test(s) ? Number(s) : s; }) : null,
    };
  };
  const pa = parse(a), pb = parse(b);
  if (!pa || !pb) return a < b ? -1 : (a > b ? 1 : 0);
  const n = Math.max(pa.core.length, pb.core.length);
  for (let i = 0; i < n; i++) {
    const x = pa.core[i] || 0, y = pb.core[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (!pa.pre && !pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  const m2 = Math.max(pa.pre.length, pb.pre.length);
  for (let j = 0; j < m2; j++) {
    const x = pa.pre[j], y = pb.pre[j];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    if (typeof x === 'number') return -1;
    if (typeof y === 'number') return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

// ---------- Pi extensions ----------
// pi 在 ~/.pi/agent/npm/node_modules/<pkg> 下管理 user extensions,
// 注册表在 ~/.pi/agent/npm/package.json (private pkg 'pi-extensions')。
// 这里用 npm CLI 直接对 ~/.pi/agent/npm 调用,绕开 npm 全局 prefix。
const PI_EXT_NPM_DIR = path.join(homeDir(), '.pi', 'agent', 'npm');

function piRunIn(args, timeoutMs) {
  return spawnSync('npm', args, {
    encoding: 'utf8',
    cwd: PI_EXT_NPM_DIR,
    shell: IS_WIN,
    timeout: timeoutMs || 0,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function piBin(args, timeoutMs) {
  // 调用 pi <subcmd>; 因为 pi 自己管 npm 安装,用 pi update 比直接 npm install 更稳
  // (pi 会同步更新 ~/.pi/settings.json 等元数据)
  return spawnSync('pi', args, {
    encoding: 'utf8',
    shell: IS_WIN,
    timeout: timeoutMs || 0,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || (process.env.HOMEDRIVE && process.env.HOMEPATH ? process.env.HOMEDRIVE + process.env.HOMEPATH : require('os').homedir());
}

// ---------- DSH web 探活 / 启动 / 重启 ----------
// dsh web（DeepSeek Harness 浏览器 UI，`npx @deepseek-ai/dsh web`）默认监听
// 127.0.0.1:3080。这一段全部同步实现：
//   - TCP 探活跑在独立子进程 scripts/lib/tcp-probe.js 里（独立事件循环，
//     socket 回调能正常触发），本进程 spawnSync 等它的 JSON 输出。
//     在本进程里直接 net.createConnection + 忙等是行不通的——同步等待同样
//     阻塞本进程事件循环，connect 回调永远不触发。
//   - sleep 用 Atomics.wait（Node 主线程可用；跨平台、不烧 CPU、不依赖
//     /bin/sleep——Windows 上没有它）。
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function probeTcpSync(host, port, timeoutMs) {
  // 经 build.js 内嵌进 host bundle 后以 `node -e` 运行：没有 __dirname、
  // 也找不到 lib/tcp-probe.js —— 退化为「端口占用者」判断（lsof/netstat）
  let probe = null;
  try { probe = path.join(__dirname, 'lib', 'tcp-probe.js'); } catch (_) {}
  if (!probe || !fs.existsSync(probe)) return lookupOwnerPid(port) !== null;
  const tm = timeoutMs || 1500;
  const r = spawnSync(process.execPath, [probe, String(host), String(port), String(tm)], {
    encoding: 'utf8',
    timeout: tm + 2000,
    maxBuffer: 64 * 1024,
  });
  if (r.error || r.status !== 0) return false;
  const out = String(r.stdout || '').trim();
  try {
    const obj = JSON.parse(out);
    return !!(obj && obj.result);
  } catch (e) {
    return false;
  }
}

function lookupOwnerPid(port) {
  // 找到占用该端口的进程 PID;macOS/Linux 用 lsof,Windows 用 netstat。
  // timeout 放宽到 8s:系统繁忙时（如刚跑完 npm install）lsof 可能超过 5s。
  let ownerPid = null;
  if (!IS_WIN) {
    const r = spawnSync('lsof', ['-nP', '-iTCP:' + port + '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8', shell: false, timeout: 8000,
    });
    if (!r.error && r.status === 0) {
      const pid = String(r.stdout || '').trim().split('\n')[0];
      if (/^\d+$/.test(pid)) ownerPid = parseInt(pid, 10);
    }
  } else {
    const r = spawnSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', shell: true, timeout: 8000 });
    if (!r.error && r.status === 0) {
      const lines = String(r.stdout || '').split(/\r?\n/);
      const portStr = ':' + port;
      for (const line of lines) {
        if (line.includes(portStr) && line.includes('LISTENING')) {
          const m = line.trim().match(/\s(\d+)\s*$/);
          if (m) { ownerPid = parseInt(m[1], 10); break; }
        }
      }
    }
  }
  return ownerPid;
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return false; }
}

// SIGTERM -> 等 graceMs -> SIGKILL;返回最终状态
function killProcess(pid, graceMs) {
  if (!pid || !/^\d+$/.test(String(pid))) {
    return { ok: false, error: 'invalid pid: ' + pid };
  }
  const p = parseInt(pid, 10);
  if (p === process.pid || p === process.ppid) {
    return { ok: false, error: 'refusing to kill self/parent (pid ' + p + ')' };
  }
  const grace = graceMs || 5000;

  try { process.kill(p, 'SIGTERM'); }
  catch (e) { return { ok: false, error: 'SIGTERM 失败: ' + String((e && e.message) || e) }; }

  const start = Date.now();
  while (Date.now() - start < grace) {
    if (!isProcessAlive(p)) return { ok: true, signal: 'SIGTERM' };
    sleepSync(100);
  }

  try { process.kill(p, 'SIGKILL'); }
  catch (e) {
    if (!e || e.code !== 'ESRCH') {
      return { ok: false, error: 'SIGKILL 失败: ' + String((e && e.message) || e) };
    }
  }
  const t2 = Date.now();
  while (Date.now() - t2 < 1000) {
    if (!isProcessAlive(p)) return { ok: true, signal: 'SIGKILL' };
    sleepSync(100);
  }
  return { ok: false, error: 'SIGKILL 后进程仍存活' };
}

// 全局 bin 路径：npm root -g = <prefix>/lib/node_modules（win: <prefix>\node_modules），
// 全局可执行在 <prefix>/bin（win: <prefix> 本身，dsh.cmd）。找不到返回 ''。
function globalBin(bin) {
  try {
    const prefix = path.dirname(path.dirname(NPM_ROOT));
    const p = IS_WIN ? path.join(prefix, bin + '.cmd') : path.join(prefix, 'bin', bin);
    return fs.existsSync(p) ? p : '';
  } catch (_) { return ''; }
}

function dshPin() {
  const t = TOOLS.filter(function (x) { return x.id === 'dsh'; })[0];
  return (t && t.pin) || '';
}

function launchDshWeb() {
  // detached + unref:子进程在父进程退出后继续运行;父进程不等它退出。
  // 优先用全局安装的 dsh 二进制——版本受本脚本 pin 管控;`npx -y @deepseek-ai/dsh`
  // 每次从 registry 解析 latest,会绕开 pin 拉到不兼容版本。全局二进制缺失
  // (安装失败等)才退回 npx,且 spec 带 pin,不追 latest。
  const pin = dshPin();
  const spec = pin ? '@deepseek-ai/dsh@' + pin : '@deepseek-ai/dsh';
  const bin = globalBin('dsh');
  const argv = bin ? [bin, 'web', '--no-open'] : ['npx', '-y', spec, 'web', '--no-open'];
  if (DSH_WEB_HOST.port !== 3080) argv.push('--port', String(DSH_WEB_HOST.port));
  if (DSH_WEB_HOST.host !== '127.0.0.1') argv.push('--host', DSH_WEB_HOST.host);
  try {
    const child = require('child_process').spawn(argv[0], argv.slice(1), {
      detached: true, stdio: 'ignore', shell: IS_WIN, cwd: homeDir(), windowsHide: true,
    });
    child.unref();
    return { ok: true, pid: child.pid, argv: argv };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), argv: argv };
  }
}

// 检测本进程是否从 DSH GUI 内 spawn (启发式: ppid 链上含 dsh/web/deepseek-harness)
function detectInDshGui() {
  if (IS_WIN) return detectInDshGuiWin();
  let pid = process.ppid;
  let hops = 0;
  while (pid && pid !== 1 && hops < 6) {
    try {
      const r = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], {
        encoding: 'utf8', shell: false, timeout: 2000,
      });
      if (r.error || r.status !== 0) break;
      const comm = String(r.stdout || '').trim();
      if (/dsh|deepseek-harness|node.*dsh/i.test(comm)) return true;
    } catch (_) { break; }
    try {
      const r2 = spawnSync('ps', ['-p', String(pid), '-o', 'ppid='], {
        encoding: 'utf8', shell: false, timeout: 2000,
      });
      if (r2.error || r2.status !== 0) break;
      const ppid = parseInt(String(r2.stdout || '').trim(), 10);
      if (!ppid || ppid === pid) break;
      pid = ppid;
    } catch (_) { break; }
    hops++;
  }
  return false;
}

// Windows 无 ps：用 PowerShell 沿 ParentProcessId 链取 CommandLine（一次调用）
function detectInDshGuiWin() {
  const script = '$p=' + process.ppid + '; while($p -and $p -ne 0 -and $p -ne 4){' +
    '$c=Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue;' +
    'if(-not $c){break}; $c.CommandLine; $p=$c.ParentProcessId }';
  try {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', script], {
      encoding: 'utf8', timeout: 15000,
    });
    if (r.error || r.status !== 0) return false;
    return /dsh|deepseek[-_]harness|deepseek-ai/i.test(String(r.stdout || ''));
  } catch (_) { return false; }
}

// lsof 慢/失败时的兜底：ps 扫描命令行里的 dsh web 进程
// （`node …/bin/dsh web` 本体与 `npm exec @deepseek-ai/dsh web` / `npx …` 包装器）。
// 只认以上两种形状，dsh-doctor supervisor、编辑器打开的同名文件等不会误伤。
function scanPsForDshWeb() {
  if (IS_WIN) return []; // Windows 无 ps；端口归属走 netstat 路径
  const r = spawnSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', timeout: 8000 });
  if (r.error || r.status !== 0) return [];
  const mine = new Set([process.pid, process.ppid]);
  const out = [];
  for (const line of String(r.stdout || '').split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = parseInt(m[1], 10), ppid = parseInt(m[2], 10), cmd = m[3];
    if (mine.has(pid)) continue;
    const isListener = /(^|\/)dsh\s+web(\s|$)/.test(cmd);
    const isWrapper = /^(npm|npx)\s+(exec\s+)?@?deepseek-ai\/dsh\s+web/.test(cmd);
    if (!isListener && !isWrapper) continue;
    out.push({ pid: pid, ppid: ppid, cmd: cmd, wrapper: !isListener });
  }
  return out;
}

// 定位要 kill 的 dsh web 进程：优先端口占用者（最准，能识别自定义端口）；
// 拿不到（lsof 超时等）再退回 ps 命令行扫描。都失败返回 {pid: null}。
function findDshWebPid(port) {
  for (let i = 0; i < 2; i++) {
    const pid = lookupOwnerPid(port);
    if (pid) return { pid: pid, how: 'port-owner' };
  }
  const cands = scanPsForDshWeb();
  const pick = cands.filter(function (c) { return !c.wrapper; })[0] || cands[0];
  if (pick) return { pid: pick.pid, how: 'ps-scan', cmd: pick.cmd };
  return { pid: null, how: 'none' };
}

// kill 监听进程后，向上清理 dsh 相关的包装进程（如 `npm exec @deepseek-ai/dsh web`）；
// 一旦遇到非 dsh 进程（用户 shell 等）立即停手，绝不误杀终端。
function killDshAncestors(childPid) {
  if (IS_WIN) return []; // 包装进程会随子进程退出，Windows 上不额外追溯
  const killed = [];
  let cur = childPid;
  for (let hops = 0; hops < 4; hops++) {
    const r = spawnSync('ps', ['-p', String(cur), '-o', 'ppid='], { encoding: 'utf8', timeout: 2000 });
    if (r.error || r.status !== 0) break;
    const pp = parseInt(String(r.stdout || '').trim(), 10);
    if (!pp || pp === 1 || pp === process.pid) break;
    const rc = spawnSync('ps', ['-p', String(pp), '-o', 'command='], { encoding: 'utf8', timeout: 2000 });
    if (rc.error || rc.status !== 0) break;
    const cmd = String(rc.stdout || '').trim();
    if (!cmd || !/dsh|deepseek[-_]harness|deepseek-ai/i.test(cmd)) break;
    const k = killProcess(pp, 3000);
    if (k.ok) killed.push(pp);
    cur = pp;
  }
  return killed;
}

// 等端口彻底空闲（占用者死亡 + TCP 无响应）；deadline 后再复核一次
function waitForPortFree(host, port, timeoutMs) {
  const free = function () { return lookupOwnerPid(port) === null && !probeTcpSync(host, port, 400); };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (free()) return true;
    sleepSync(250);
  }
  return free();
}

// 启动后轮询端口直到 bind；npx 首次下载依赖可能较慢，给足 60s
function waitForBind(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    sleepSync(1000);
    if (probeTcpSync(host, port, 500)) return true;
  }
  return false;
}

function launchDshWebAndWait() {
  const r = launchDshWeb();
  if (!r.ok) {
    out('    ✗ 启动失败: ' + (r.error || 'unknown'));
    return Object.assign({ bound: false }, r);
  }
  out('    · 已 spawn (pid ' + r.pid + ')，等待端口 bind（最多 60s，npx 首次下载依赖可能较慢）…');
  const bound = waitForBind(DSH_WEB_HOST.host, DSH_WEB_HOST.port, 60000);
  if (!bound) {
    out('    ! 60s 内端口未 bind；npx 可能仍在下载依赖，稍后手动访问 ' + DSH_WEB_URL + ' 确认');
    return Object.assign({ bound: false }, r);
  }
  out('    ✓ 已就绪: ' + DSH_WEB_URL);
  // dsh web 先 bind 端口、后加载 profile 插件；插件与当前 dsh 不兼容时会在
  // bind 后数秒内退出（实测 0.1.2-rc.1 在 2~8s 内崩，单次 3s 复核抓不到）。
  // 就绪后轮询 ~15s 全程存活才算稳定，避免「报告已就绪、实际已崩溃」的假阳性。
  let stable = true;
  for (let i = 0; i < 10; i++) {
    sleepSync(1500);
    if (!probeTcpSync(DSH_WEB_HOST.host, DSH_WEB_HOST.port, 500)) { stable = false; break; }
  }
  if (!stable) {
    out('    ! 进程在就绪后 ~15s 内退出——通常是 ~/.dsh/profiles/web 下的插件与当前 dsh 不兼容');
    const pin = dshPin();
    if (pin) {
      out('      本脚本已锁定兼容版本 ' + pin + '；若仍失败可在该 profile 目录执行 npm update 升级插件后重试');
    } else {
      out('      可在该 profile 目录执行 npm update 升级插件后重试，或暂时回退旧版: npm i -g @deepseek-ai/dsh@<旧版本号>');
    }
    return Object.assign({ bound: true, stable: false }, r);
  }
  return Object.assign({ bound: true, stable: true }, r);
}


function piExtensionsInstalled() {
  // 返回 [{name, dir, version}] 当前装的 extensions
  // 解析 ~/.pi/agent/npm/package.json 的 dependencies
  const pj = path.join(PI_EXT_NPM_DIR, 'package.json');
  if (!fs.existsSync(pj)) return [];
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(pj, 'utf8')); } catch (_) { return []; }
  const deps = pkg.dependencies || {};
  const list = [];
  for (const name of Object.keys(deps)) {
    const extDir = path.join(PI_EXT_NPM_DIR, 'node_modules', name);
    let ver = '';
    try {
      ver = JSON.parse(fs.readFileSync(path.join(extDir, 'package.json'), 'utf8')).version || '';
    } catch (_) {}
    list.push({ name: name, dir: extDir, version: ver });
  }
  return list;
}

function piExtensionsCheck() {
  // 返回每个 extension 的状态（ok / upgradable / installable / external / unknown / error）
  const installed = piExtensionsInstalled();
  if (installed.length === 0) {
    return { available: false, reason: 'no-package-json-or-empty', results: [] };
  }
  const results = [];
  for (const ext of installed) {
    const lat = latestVersion(ext.name);
    let status, action;
    if (!lat) {
      status = 'unknown';
      action = '无法查询 npm registry';
    } else if (!ext.version) {
      status = 'external';
      action = 'package.json 无法解析版本';
    } else if (ext.version === lat) {
      status = 'ok';
      action = '已是最新';
    } else {
      status = 'upgradable';
      action = '可升级 ' + ext.version + ' → ' + lat;
    }
    results.push({
      name: ext.name,
      installed: ext.version,
      latest: lat || '-',
      status: status,
      action: action,
    });
  }
  return { available: true, results: results };
}

function piExtensionsUpgrade() {
  // 调 `pi update --all` 一并升级 pi 自身和所有 extensions。
  // pi 会输出一坨 npm 的日志,其中 `Updating npm:<pkg>...` 标记哪个 extension 被升级了。
  const before = piExtensionsInstalled();
  const beforeMap = {};
  for (const ext of before) beforeMap[ext.name] = ext.version;

  const t0 = Date.now();
  const res = piBin(['update', '--all'], 600000);
  const elapsed = Date.now() - t0;

  // 解析 stdout,找出被升级的 extensions
  const stdout = String(res.stdout || '');
  const stderr = String(res.stderr || '');
  const upgradedNames = new Set();
  // "Updating npm:<name>..." 单独一行,告诉我们 pi 在更新哪个
  const updateLineRe = /Updating\s+npm:([^\s.]+)/g;
  let m;
  while ((m = updateLineRe.exec(stdout)) !== null) {
    upgradedNames.add(m[1]);
  }

  // 重新读 extensions 当前版本
  const after = piExtensionsInstalled();
  const afterMap = {};
  for (const ext of after) afterMap[ext.name] = ext.version;

  const results = [];
  for (const ext of after) {
    const before = beforeMap[ext.name] || '';
    const after_ = afterMap[ext.name] || '';
    let status, action;
    if (!after_) {
      status = 'error';
      action = '升级后无法读版本';
    } else if (upgradedNames.has(ext.name) || (before && before !== after_)) {
      status = 'upgraded';
      action = '已升级 ' + (before || '-') + ' → ' + after_;
    } else if (before && before === after_) {
      status = 'ok';
      action = '已是最新';
    } else {
      // 全新安装的 extension 不会出现在这里,因为我们只升级已存在的
      status = 'unknown';
      action = '升级状态不明';
    }
    results.push({
      name: ext.name,
      installed: after_,
      latest: latestVersion(ext.name) || '-',
      status: status,
      action: action,
    });
  }

  const error = res.error ? (res.error.message || String(res.error)) : null;
  return {
    ok: !error && res.status === 0,
    exit_code: res.status,
    error: error,
    elapsed_ms: elapsed,
    stdout_tail: stdout.slice(-1500),
    stderr_tail: stderr.slice(-800),
    results: results,
  };
}

function binProbe(binName) {
  // 返回 { exists, version }
  const res = run(binName, ['--version'], 60000);
  if (res.error || res.status !== 0) return { exists: false, version: '' };
  return { exists: true, version: String(res.stdout || '').trim().split('\n')[0] || '' };
}

function sanitize(s) {
  return String(s || '').replace(/[\n\r\t|]+/g, ' ').replace(/\|/g, '/').slice(0, 200);
}

function eaccHint(pkgName) {
  if (IS_WIN) return '全局 npm 目录无写权限，请检查 %APPDATA%\\npm 权限或以管理员运行';
  return '全局 npm 目录无写权限(EACCES)。方案A: sudo npm install -g ' + pkgName + '@latest；方案B(推荐): npm config set prefix ~/.npm-global 并把 ~/.npm-global/bin 加入 PATH';
}

// ---------- 主流程 ----------
function main() {
  if (!NPM_ROOT) {
    out('✗ 无法确定 npm 全局目录（npm root -g 失败），请确认已安装 Node.js/npm');
    process.exit(1);
  }

  const modeLabel = CHECK_ONLY ? '仅检查（--check，不做改动）' : '检查并自动更新';
  out('==============================================================');
  out(' FoxAI CLI 工具更新  [' + modeLabel + ']');
  out(' 系统: ' + process.platform + '  npm 全局目录: ' + NPM_ROOT);
  out(' 时间: ' + new Date().toLocaleString());
  out('==============================================================');

  // 校验 --only 子集:识别并拒绝拼写错的工具 id,避免静默成功
  let filteredTools = TOOLS;
  if (onlySet && onlySet.length > 0) {
    const knownIds = new Set(TOOLS.map(function (t) { return t.id; }));
    const unknown = onlySet.filter(function (id) { return !knownIds.has(id); });
    if (unknown.length > 0) {
      out('✗ --only 包含未知工具 id: ' + unknown.join(', ') + '（合法值: ' + Array.from(knownIds).join(', ') + '）');
      process.exit(2);
    }
    filteredTools = TOOLS.filter(function (t) { return onlySet.indexOf(t.id) !== -1; });
    if (filteredTools.length === 0) {
      out('✗ --only 过滤后没有可用工具');
      process.exit(2);
    }
  }

  out(['工具'.padEnd(9), '状态'.padEnd(13), '当前版本'.padEnd(11), '最新版本'.padEnd(11), '操作'].join(''));
  out('--------------------------------------------------------------');

  const results = [];
  const summary = {};
  const bump = (s) => { summary[s] = (summary[s] || 0) + 1; };
  // 收集本次 upgrade/install 成功的工具 id，用于后续做环境变量恢复
  const envRestoreApps = new Set();
  // cc-switch-restore 只认 APP_TARGETS 里登记过的 app（claude/codex）；
  // 其它工具（如 dsh）没有对应的 CC Switch 配置，不进恢复列表
  const RESTORE_APPS = new Set(['claude', 'codex']);

  for (const t of filteredTools) {
    const cur = installedVersion(t.pkg);
    const lat = latestVersion(t.pkg);
    // 目标版本：有 pin（兼容性锁，见 TOOLS 注册表注释）用 pin，否则 registry
    // latest。pin 是本地常量，即使网络拿不到 latest 也能照常比对/安装。
    const target = t.pin || lat;
    let status = '', action = '', verFrom = cur || '-', verTo = target || '-', err = '';

    if (!target) {
      const bp = binProbe(t.bin);
      if (bp.exists) {
        status = 'external'; verFrom = bp.version || '-'; verTo = '-';
        action = '非 npm 渠道安装，跳过；且无法查询 registry';
      } else {
        status = 'unknown';
        action = '无法查询 npm registry（检查网络）';
      }
    } else if (!cur) {
      const bp = binProbe(t.bin);
      if (bp.exists) {
        // 二进制存在但非 npm 全局（brew / winget / 官方安装器等），避免双渠道冲突
        status = 'external'; verFrom = bp.version || '-';
        action = '非 npm 渠道安装（如 brew/scoop），跳过；如需接管请先卸载原渠道版本';
      } else if (CHECK_ONLY) {
        status = 'installable';
        action = '未安装，将安装 ' + target;
      } else {
        out('  … 正在安装 ' + t.name + ' (' + t.pkg + '@' + target + ')');
        const res = npm(['install', '-g', '--no-fund', '--no-audit', t.pkg + '@' + target], 600000);
        if (!res.error && res.status === 0) {
          status = 'installed'; verFrom = '-'; verTo = installedVersion(t.pkg) || target;
          action = '已安装 ' + verTo;
          if (RESTORE_APPS.has(t.id)) envRestoreApps.add(t.id);
        } else {
          status = 'error'; action = '安装失败';
          err = extractErr(res, t);
        }
      }
    } else if (cur === target) {
      status = 'ok';
      if (t.pin && lat && lat !== cur) {
        action = '已锁定 ' + cur + '（latest ' + lat + ' 因兼容性暂缓）';
      } else {
        action = '已是最新';
      }
    } else if (CHECK_ONLY) {
      status = 'upgradable';
      if (t.pin && verCmp(cur, target) > 0) {
        action = '需回退 ' + cur + ' → ' + target + '（兼容性锁定 ' + target + '）';
      } else {
        action = '可升级 ' + cur + ' → ' + target;
      }
    } else {
      const down = !!(t.pin && verCmp(cur, target) > 0);
      out('  … 正在' + (down ? '回退 ' : '升级 ') + t.name + ' ' + cur + ' → ' + target);
      const res = npm(['install', '-g', '--no-fund', '--no-audit', t.pkg + '@' + target], 600000);
      if (!res.error && res.status === 0) {
        status = 'upgraded'; verTo = installedVersion(t.pkg) || target;
        action = (down ? '已回退 ' : '已升级 ') + cur + ' → ' + verTo;
        if (RESTORE_APPS.has(t.id)) envRestoreApps.add(t.id);
      } else {
        status = 'error'; action = (down ? '回退失败' : '升级失败') + '（仍为 ' + cur + '）';
        err = extractErr(res, t);
      }
    }

    bump(status);

    const icon = { ok: '✓', upgradable: '!', installable: '!', upgraded: '↑', installed: '↑', external: '○', unknown: '?' }[status] || '✗';
    out([t.id.padEnd(9), (icon + ' ' + status).padEnd(13), String(verFrom).padEnd(11), String(verTo).padEnd(11), action].join(''));
    if (err) out('          错误详情: ' + sanitize(err));

    results.push({ id: t.id, name: t.name, status: status, installed: verFrom, latest: verTo, action: action, error: sanitize(err) });
  }

  // 升级/安装成功后,从 CC Switch 恢复环境变量(默认开启)
  // 用户的 AI API 配置在 CC Switch 里(智谱 / MiniMax / DeepSeek 等 6+ provider);
  // claude 升级有时会清掉 ~/.claude/settings.json,导致 'claude 不能启动'。
  // 这里从 ~/.cc-switch/cc-switch.db 读 is_current=1 的 provider,覆盖写回 env 段,
  // 让 claude 升级后立即能用,无需手动进 CC Switch GUI 点"应用"。
  let envRestore = { skipped: true, reason: 'no-upgrades' };
  if (!CHECK_ONLY && envRestoreApps.size > 0) {
    if (NO_RESTORE) {
      envRestore = { skipped: true, reason: '--no-restore' };
    } else if (!ccRestore) {
      envRestore = { skipped: true, reason: 'cc-switch-restore 模块加载失败' };
    } else {
      out('--------------------------------------------------------------');
      out('  … CC Switch 环境变量恢复: ' + Array.from(envRestoreApps).join(', '));
      envRestore = { skipped: false, by_app: {} };
      for (const appId of envRestoreApps) {
        try {
          const r = ccRestore.restoreForApp(appId);
          envRestore.by_app[appId] = r;
          const icon2 = r.ok && r.status === 'restored' ? '✓' : (r.ok ? '·' : '✗');
          out('    ' + icon2 + ' ' + appId + ': ' + (r.message || r.error || ('status=' + r.status)));
        } catch (e) {
          envRestore.by_app[appId] = { ok: false, error: String((e && e.message) || e) };
          out('    ✗ ' + appId + ': 异常 ' + String((e && e.message) || e));
        }
      }
    }
  }

  // Pi extensions 检查 / 升级
  // pi 在 ~/.pi/agent/npm/node_modules/ 下管理 user extensions
  // (pi-mcp-adapter / pi-subagents / pi-web-access / pi-wechat-assistant 等),
  // 检查时直接对每个 extension 比对 installed vs latest,升级时调 `pi update --all`,
  // 一并处理 pi 自身 + 所有 extensions。--only=pi 时独立处理;其它情况也会扫一次
  // 因为用户可能在 pi 自身已是最新时仍有 extension 待升级。
  let piExt = { skipped: true, reason: 'not-applicable' };
  const piInScope = !onlySet || onlySet.indexOf('pi') !== -1;
  const piExists = (function () {
    const bp = binProbe('pi');
    return bp.exists;
  })();
  if (piInScope && piExists) {
    try {
      out('--------------------------------------------------------------');
      out('  … Pi extensions:');
      if (CHECK_ONLY) {
        const chk = piExtensionsCheck();
        if (!chk.available) {
          out('    · 跳过: ' + chk.reason);
          piExt = { skipped: true, reason: chk.reason };
        } else if (chk.results.length === 0) {
          out('    · 无已安装 extension');
          piExt = { available: true, results: [] };
        } else {
          out('    ' + ['extension'.padEnd(24), '状态'.padEnd(13), '当前版本'.padEnd(11), '最新版本'.padEnd(11), '操作'].join(''));
          for (const r of chk.results) {
            const icon = { ok: '✓', upgradable: '!', installable: '!', upgraded: '↑', installed: '↑', external: '○', unknown: '?' }[r.status] || '✗';
            out('    ' + [r.name.padEnd(24), (icon + ' ' + r.status).padEnd(13), String(r.installed).padEnd(11), String(r.latest).padEnd(11), r.action].join(''));
          }
          piExt = { skipped: false, check_only: true, results: chk.results };
        }
      } else {
        out('    运行 `pi update --all` ...');
        const up = piExtensionsUpgrade();
        piExt = { skipped: false, check_only: false, upgrade: up };
        if (up.results.length === 0) {
          out('    · 无已安装 extension');
        } else {
          out('    ' + ['extension'.padEnd(24), '状态'.padEnd(13), '当前版本'.padEnd(11), '最新版本'.padEnd(11), '操作'].join(''));
          for (const r of up.results) {
            const icon = { ok: '✓', upgradable: '!', installable: '!', upgraded: '↑', installed: '↑', external: '○', unknown: '?', error: '✗' }[r.status] || '✗';
            out('    ' + [r.name.padEnd(24), (icon + ' ' + r.status).padEnd(13), String(r.installed).padEnd(11), String(r.latest).padEnd(11), r.action].join(''));
          }
        }
        if (!up.ok) {
          out('    ✗ pi update 退出码 ' + up.exit_code + (up.error ? ' / ' + up.error : ''));
        }
      }
    } catch (e) {
      piExt = { skipped: true, reason: 'exception', error: String((e && e.message) || e) };
      out('    \u2717 pi extensions 处理异常: ' + String((e && e.message) || e));
    }
  }

  // ===== DSH web: 探活 / 启动 / kill+重启（全程同步，见函数区注释）=====
  let dshWeb = { skipped: true, reason: 'not-applicable' };
  const dshInScope = !onlySet || onlySet.indexOf('dsh') !== -1;
  if (dshInScope) {
    out('--------------------------------------------------------------');
    out('  … DSH web (' + DSH_WEB_URL + '):');
    const running = probeTcpSync(DSH_WEB_HOST.host, DSH_WEB_HOST.port, 1500);
    const ownerPid = running ? lookupOwnerPid(DSH_WEB_HOST.port) : null;
    const base = {
      running: running,
      owner_pid: ownerPid,
      url: DSH_WEB_URL,
      host: DSH_WEB_HOST.host,
      port: DSH_WEB_HOST.port,
    };

    if (CHECK_ONLY) {
      dshWeb = Object.assign({ skipped: true, reason: 'check-only' }, base);
      out(running
        ? '    · 正在运行' + (ownerPid ? ' (pid ' + ownerPid + ')' : '') + ' — 检查模式不做改动'
        : '    · 未运行 — 检查模式不做改动');
    } else if (!running) {
      if (LAUNCH_DSH_WEB || RESTART_DSH_WEB) {
        out('    · 未运行，启动 `dsh web --no-open`（全局二进制' + (dshPin() ? '，版本锁定 ' + dshPin() : '') + '）…');
        dshWeb = Object.assign({ action: 'launched' }, base, launchDshWebAndWait());
      } else {
        dshWeb = Object.assign({ action: 'detected-not-running' }, base);
        out('    · 未运行；启动需 --launch-dsh-web（一键脚本默认带此 flag）');
      }
    } else if (!RESTART_DSH_WEB) {
      dshWeb = Object.assign({ action: 'detected-running' }, base);
      out('    · 已在运行' + (ownerPid ? ' (pid ' + ownerPid + ')' : '') + ' — 不动它；重启需 --restart-dsh-web');
    } else if (detectInDshGui()) {
      dshWeb = Object.assign({ action: 'skipped-self-in-dsh-gui' }, base, { in_dsh_gui: true });
      out('    ! 已在运行 (pid ' + (ownerPid || '?') + ')，且本脚本疑似由 DSH GUI 内的会话派生');
      out('      为避免杀掉正在使用的 GUI，跳过重启；请关闭 DSH 后在普通终端重跑一键脚本');
    } else {
      const found = findDshWebPid(DSH_WEB_HOST.port);
      if (!found.pid) {
        dshWeb = Object.assign({ action: 'restart-no-pid' }, base);
        out('    ! 找不到 DSH web 进程 pid（端口占用者与 ps 扫描均未命中），跳过 kill');
      } else {
        out('    · 已在运行 (pid ' + found.pid + (found.how === 'ps-scan' ? '，经 ps 扫描定位' : '') + ')，--restart-dsh-web：kill 后重启 …');
        const k = killProcess(found.pid, 5000);
        if (!k.ok) {
          dshWeb = Object.assign({ action: 'kill-error' }, base, { kill: k, killed_pid: found.pid });
          out('    ✗ kill 失败: ' + k.error + ' — 跳过启动');
        } else {
          out('    ✓ 已 kill pid ' + found.pid + ' (' + k.signal + ')');
          const ancKilled = killDshAncestors(found.pid);
          if (ancKilled.length > 0) out('    ✓ 已清理包装进程: pid ' + ancKilled.join(', '));
          if (!waitForPortFree(DSH_WEB_HOST.host, DSH_WEB_HOST.port, 5000)) {
            dshWeb = Object.assign({ action: 'port-still-busy' }, base, { kill: k, killed_pid: found.pid, pid_source: found.how, ancestors_killed: ancKilled });
            out('    ! 端口仍被占用（可能有残留子进程），跳过启动');
          } else {
            out('    · 端口已释放，启动新实例 …');
            dshWeb = Object.assign({ action: 'restarted' }, base, { kill: k, killed_pid: found.pid, pid_source: found.how, ancestors_killed: ancKilled }, launchDshWebAndWait());
          }
        }
      }
    }
  }

  out('--------------------------------------------------------------');
  out('汇总: ' + [
    (summary.ok || 0) + ' 已最新',
    ((summary.upgradable || 0) + (summary.installable || 0) + (summary.upgraded || 0)) + ' 升级(或待处理)',
    (summary.installed || 0) + ' 新装',
    (summary.external || 0) + ' 外部渠道',
    (summary.unknown || 0) + ' 未知',
    (summary.error || 0) + ' 失败',
  ].join(' / '));

  if (EMIT_JSON) {
    out('##JSON##' + JSON.stringify({
      checked_at: new Date().toISOString(),
      check_only: CHECK_ONLY,
      results: results,
      summary: summary,
      env_restore: envRestore,
      pi_extensions: piExt,
      dsh_web: dshWeb,
    }));
  }
  process.exit((summary.error || 0) > 0 ? 1 : 0);
}

function extractErr(res, t) {
  if (res.error) {
    if (res.error.code === 'ETIMEDOUT') return '执行超时';
    return res.error.message || String(res.error);
  }
  const tail = String(res.stderr || res.stdout || '').trim().split('\n').slice(-3).join(' ');
  if (/EACCES|permission denied/i.test(tail)) return eaccHint(t.pkg) + ' | ' + tail;
  return tail || ('npm 退出码 ' + res.status);
}

main();
