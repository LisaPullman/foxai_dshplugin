#!/usr/bin/env node
// =============================================================
// foxai_update — AI CLI 编码工具 检查/安装/升级（跨平台：macOS / Linux / Windows）
// 管辖工具: claude code / codex cli / gemini cli / opencode / pi / grok /
//   dsh(deepseek harness) / herdr(brew)；另有可选工具(openclaw / hermes)，
//   默认跳过，仅 --with 点名或 --only 显式指定时才纳入。
//
// 用法:
//   node update-cli-tools.js                    检查并自动安装/升级到最新
//   node update-cli-tools.js --check            只检查报告，不做任何改动
//   node update-cli-tools.js --json             末尾追加 ##JSON## 行（供插件解析）
//   node update-cli-tools.js --only pi,claude   只处理指定子集
//   node update-cli-tools.js --with openclaw,hermes  额外纳入可选工具(默认跳过,
//                                                 可重复出现自动合并,如两次 --with <id>)
//   node update-cli-tools.js --update-node        Node.js 落后时按渠道升级(nvm/brew/
//                                                 scoop/nvm-windows/winget);默认只报告
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
  // grok 的 postinstall 负责从 per-platform optional dep（@xai-official/grok-<plat>-<arch>）
  // 解压 native 二进制到 bin/grok-native（141MB Mach-O）。npm 11+ 默认开启 allow-scripts
  // 安全策略：未在白名单的 install scripts 会被静默跳过——不传 --allow-scripts，postinstall
  // 不跑，CLI 启动会找不到 native（解到一半就退出会留下损坏的二进制，更难排查）。
  // 这里列白名单后，install 调用会自动追加 --allow-scripts=<pkg>（buildInstallArgs）；
  // 装完后探测 nativeBin 是否就位，未就位则自动重试一次（捕获「白名单生效但仍失败」）。
  { id: 'grok',     name: 'Grok CLI',    pkg: '@xai-official/grok',             bin: 'grok',
    allowScripts: ['@xai-official/grok'], nativeBin: 'bin/grok-native' },
  { id: 'dsh',      name: 'DeepSeek Harness', pkg: '@deepseek-ai/dsh',           bin: 'dsh',
    // 兼容性锁：0.1.2-rc.1 移除了 @deepseek-ai/dsh-settings 的 settingsNamespace
    // 导出，~/.dsh/profiles/web 的插件生态（@linxin666/dsh-web-ui-all@0.3.6 的
    // web-ui-settings 入口依赖它）尚未跟进，dsh web 会在 bind 端口后 2~8s 内
    // 崩溃（ERR_CONNECTION_REFUSED）。插件侧 latest(0.3.6) 即当前已装版本，无可
    // 升级项——在上游适配前锁在 0.1.1-rc.2（2026-09 验证可用）。插件生态追上后
    // 删除本 pin 字段即恢复追最新。
    pin: '0.1.1-rc.2' },
  // 可选工具（opt-in）：默认跳过（不查、不装、不升级），仅当调用方显式
  // --with openclaw,hermes 或 --only 点名时才纳入——保证插件/CI 等非交互调用
  // 行为不变。一键脚本(.command/.bat/.sh)会先问用户 y/n，答 y 才附加 --with。
  // 注意：npm 上的 `opencraw` 是 0.0.1-security 占位包，正确包名是 openclaw
  // （多渠道 AI 网关，CalVer 版本号）；hermes-agent 的 bin 有 hermes/hermes-npm/
  // hermes-agent 三个，取主命令 hermes 探测。
  { id: 'openclaw', name: 'OpenClaw',     pkg: 'openclaw',     bin: 'openclaw', optIn: true },
  { id: 'hermes',   name: 'Hermes Agent', pkg: 'hermes-agent', bin: 'hermes',   optIn: true },
  // herdr：终端工作区管理器（AI coding agents 用），Homebrew 渠道。ensure-only：
  // 只保证「装没装」——未装则 brew install，已装即报 ok，不查 registry、不做
  // 版本监测/升级（升级交给用户手动 brew upgrade）。注意 npm 上的 herdr 是
  // 同名占位包（0.0.0 不可用），绝不能走 npm 渠道安装。
  { id: 'herdr',   name: 'Herdr',       pkg: '',                               bin: 'herdr',
    ensureOnly: 'brew' },
];

// ---------- 参数解析（兼容 node file.js 与 node -e SCRIPT -- … 两种运行方式） ----------
function parseArgs(argv) {
  const opts = { check: false, json: false, only: null, with: null };
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
    } else if (a === '--with') {
      // 同 --only 的取值规则:紧跟值或 --with=<ids>。可重复出现,逗号合并
      // (入口脚本对每个可选工具独立询问、各自追加一个 --with <id>)
      const v = argv[i + 1];
      if (v && !v.startsWith('--')) { opts.with = opts.with ? opts.with + ',' + v : v; i++; }
      else { opts.with = ''; }
    } else if (a.indexOf('--with=') === 0) {
      const v2 = a.slice(7);
      opts.with = opts.with ? opts.with + ',' + v2 : v2;
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
// 自动从 ~/.dsh/profiles/web/package.json 的 dsh.profile.bundles 移除 dsh web 启动失败时
// 报错的插件条目(常见: GitHub 源 prepack 没跑导致 shared/ 缺失、插件作者把 loader name
// 写成了跟 bundle 名字不一样的形式)。操作前会备份原文件(.bak.<ts>),只移除 stderr
// 中明确提到的 bundle,避免误伤其它正常插件;且仅在自愈(symlink/shared 重建)治不好时
// 才执行。默认开启——一键脚本、核心脚本直跑、DSH 插件路径行为一致;不想要的调用方
// 显式传 --no-auto-disable-dsh-plugins 关掉。
const AUTO_DISABLE_DSH_BROKEN = (function () {
  if (process.argv.indexOf('--no-auto-disable-dsh-plugins') !== -1) return false;
  return true; // --auto-disable-dsh-plugins 旧 flag 保留兼容,现为默认行为
})();
const DSH_WEB_URL = process.env.DSH_WEB_URL || 'http://127.0.0.1:3080';
const DSH_WEB_HOST = (function () {
  try {
    const u = new URL(DSH_WEB_URL);
    return { host: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)) };
  } catch (e) { return { host: '127.0.0.1', port: 3080 }; }
})();
// 仅当 only 是字符串(可能为空)时建立 onlySet,null 表示未传 --only
const onlySet = OPTS.only === null ? null : OPTS.only.split(',').map(function (s) { return s.trim() });
// 同上,--with 的 id 集合(额外纳入的可选工具)
const withSet = OPTS.with === null ? null : OPTS.with.split(',').map(function (s) { return s.trim() });

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

// 探测 npm 主版本号（缓存到进程级）。--allow-scripts 是 npm 11+ 才有的 flag，
// npm 10/9 传过去会被当成未知选项拒绝 install。buildInstallArgs 据此守卫：
// < 11 时不带 --allow-scripts=...（保持旧行为，避免兼容性问题）。
let _npmMajorCache = null;
function npmMajor() {
  if (_npmMajorCache !== null) return _npmMajorCache;
  const res = npm(['--version'], 5000);
  if (res.error || res.status !== 0) { _npmMajorCache = 0; return 0; }
  const m = String(res.stdout || '').trim().match(/^(\d+)/);
  _npmMajorCache = m ? parseInt(m[1], 10) : 0;
  return _npmMajorCache;
}

// ---------- 前置检查 ----------
function NPM_ROOT_OF() {
  const res = npm(['root', '-g'], 60000);
  if (res.error || res.status !== 0) return '';
  return String(res.stdout || '').trim().split('\n').pop().trim();
}

// let：node 升级成功后会在 main 的 Node.js 阶段重算（npm prefix 可能随新 node 变化）
let NPM_ROOT = NPM_ROOT_OF();

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
  try { process.kill(pid, 0); }
  catch (e) { return false; }
  // kill(pid,0) 对僵尸进程同样返回成功。本脚本等待端口 bind 期间同步阻塞事件
  // 循环（tcp-probe 子进程轮询），libuv 收不到 SIGCHLD、不会 reap 已退出的 dsh
  // 子进程——崩溃的子进程会以 Z 状态一直挂到父进程退出为止。不识别僵尸会把
  // 「已崩溃」误判为「还活着」，alive 门禁进而挡住自愈/自动禁用，dsh web 永远
  // 起不来（实测：spawn 后 3s 崩溃，60s 后 kill(pid,0) 仍成功、ps 显示 <defunct>）。
  if (IS_WIN) return true; // Windows 没有僵尸状态
  try {
    let stat = '';
    if (fs.existsSync('/proc/' + pid + '/stat')) {
      // Linux: 格式 "pid (comm) state ..."，comm 可含空格/括号，取最后 ')' 之后
      const s = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
      const idx = s.lastIndexOf(')');
      if (idx !== -1) stat = s.slice(idx + 1).trim();
    } else {
      // macOS 等 BSD：ps 的 stat 列首字母即进程状态
      const r = spawnSync('ps', ['-p', String(pid), '-o', 'stat='], {
        encoding: 'utf8', shell: false, timeout: 2000,
      });
      if (!r.error && r.status === 0) stat = String(r.stdout || '').trim();
    }
    if (stat && stat[0] === 'Z') return false; // zombie = 已退出，只是没被 wait
  } catch (_) {}
  return true;
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

// 安全读文件尾部（子进程可能未写出、文件不存在、超过 maxBytes 都容错）
function readLogTail(p, maxBytes) {
  try {
    if (!p || !fs.existsSync(p)) return '';
    const st = fs.statSync(p);
    if (!st.size) return '';
    const fd = fs.openSync(p, 'r');
    try {
      const len = Math.min(st.size, maxBytes || 2000);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.size - len);
      return String(buf).replace(/\s+$/, '');
    } finally {
      try { fs.closeSync(fd); } catch (_) {}
    }
  } catch (_) { return ''; }
}

// 把多行文本每行加缩进，便于嵌进脚本输出
function indentLines(text, prefix) {
  return String(text || '').split(/\r?\n/).map(function (l) { return prefix + l; }).join('\n');
}

// 从 dsh web 启动失败 stderr 中识别「在 dsh.profile.bundles 数组里」的损坏 bundle。
// 启发式: stderr 里 loader 报错会引用「插件在 bundle 列表里的名字」或「插件 package.json
// 里的 name 字段」,两者经常不一样(如 bundle=`@dsh-external/dsh-client-ui-skin-maid-atelier` 、
// loader name=`@smalltailqwq/dsh-client-ui-skin-maid-atelier`)。对每个 bundle 同时尝试:
//   1) 完整路径出现在 stderr → 命中
//   2) 去掉 @scope/ 后的末段名出现在 stderr → 命中(覆盖 scope 不一致的情况)
// 3) bundle 的末段名以 loader entry id 作为后缀(如 id=`ui-skin-maid-atelier`、
//    bundle 末段=`dsh-client-ui-skin-maid-atelier`)→ 取末 2 段弱匹配
function detectBrokenDshBundles(errText, allBundles) {
  if (!errText || !Array.isArray(allBundles) || allBundles.length === 0) return [];
  const out = [];
  const loaderIds = [];
  const re = /failed to import loader entry ([^\s(]+)/g;
  let m;
  while ((m = re.exec(errText)) !== null) loaderIds.push(m[1]);
  for (const b of allBundles) {
    if (!b || typeof b !== 'string') continue;
    if (errText.indexOf(b) !== -1) { out.push(b); continue; }
    const nameOnly = b.replace(/^@[^/]+\//, '');
    if (nameOnly && errText.indexOf(nameOnly) !== -1) { out.push(b); continue; }
    if (loaderIds.length > 0) {
      const tail = nameOnly.split('-').slice(-2).join('-'); // "dsh-client-ui-skin-maid-atelier" → "ui-skin-maid-atelier"
      for (const id of loaderIds) {
        if (tail && (id === tail || tail.endsWith(id) || id.endsWith(tail))) {
          out.push(b); break;
        }
      }
    }
  }
  return out;
}

// 从 ~/.dsh/profiles/web/package.json 的 dsh.profile.bundles 里移除传入的 bundle。
// 流程: 读 → 备份(.bak.<ts>)→ 改 → 写回;任何步骤失败都尝试回滚。
// 备份路径会返回,用户后续可手动 cp 回来恢复。
function disableBrokenDshBundlesInProfile(brokenBundles) {
  const result = {
    ok: false,
    profile_dir: '',
    pkg_path: '',
    backup_path: '',
    before: [],
    after: [],
    disabled: [],
    error: '',
  };
  const profileDir = (process.env.DSH_PROFILE_DIR && process.env.DSH_PROFILE_DIR.trim()) ||
    path.join(homeDir(), '.dsh', 'profiles', 'web');
  const pkgPath = path.join(profileDir, 'package.json');
  result.profile_dir = profileDir;
  result.pkg_path = pkgPath;
  if (!fs.existsSync(pkgPath)) {
    result.error = 'profile package.json 不存在: ' + pkgPath;
    return result;
  }
  let pkgText, pkg;
  try { pkgText = fs.readFileSync(pkgPath, 'utf8'); }
  catch (e) { result.error = '读取失败: ' + String((e && e.message) || e); return result; }
  try { pkg = JSON.parse(pkgText); }
  catch (e) { result.error = 'package.json 解析失败: ' + String((e && e.message) || e); return result; }
  const bundles = pkg && pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles;
  if (!Array.isArray(bundles)) {
    result.error = 'package.json 缺少 dsh.profile.bundles 数组';
    return result;
  }
  const brokenSet = new Set(brokenBundles);
  const remaining = bundles.filter(function (b) { return !brokenSet.has(b); });
  if (remaining.length === bundles.length) {
    result.ok = true;
    result.before = bundles.slice();
    result.after = bundles.slice();
    result.disabled = [];
    result.error = 'no-match'; // 信息性:未在 bundles 里找到匹配项
    return result;
  }
  // 备份
  const ts = Date.now();
  const backup = pkgPath + '.bak.' + ts;
  try { fs.copyFileSync(pkgPath, backup); }
  catch (e) { result.error = '备份失败: ' + String((e && e.message) || e); return result; }
  // 改 + 写回（保持 2 空格缩进，与现有风格一致）
  pkg.dsh.profile.bundles = remaining;
  try {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  } catch (e) {
    try { fs.copyFileSync(backup, pkgPath); } catch (_) {}
    result.error = '写回失败已回滚: ' + String((e && e.message) || e);
    return result;
  }
  result.ok = true;
  result.before = bundles.slice();
  result.after = remaining.slice();
  result.disabled = bundles.filter(function (b) { return brokenSet.has(b); });
  result.backup_path = backup;
  return result;
}

function launchDshWeb() {
  // detached + unref:子进程在父进程退出后继续运行;父进程不等它退出。
  // 优先用全局安装的 dsh 二进制——版本受本脚本 pin 管控;`npx -y @deepseek-ai/dsh`
  // 每次从 registry 解析 latest,会绕开 pin 拉到不兼容版本。全局二进制缺失
  // (安装失败等)才退回 npx,且 spec 带 pin,不追 latest。
  //
  // 子进程 stdout/stderr 重定向到临时日志文件,失败诊断用 —— stdio:'ignore' 时
  // dsh web 即便崩了也看不到任何错误,只能等 60s 超时猜原因。文件由子进程 fd
  // 持有,父 closeSync 不影响;子进程退出后文件仍在,可安全读取。
  const pin = dshPin();
  const spec = pin ? '@deepseek-ai/dsh@' + pin : '@deepseek-ai/dsh';
  const bin = globalBin('dsh');
  const argv = bin ? [bin, 'web', '--no-open'] : ['npx', '-y', spec, 'web', '--no-open'];
  if (DSH_WEB_HOST.port !== 3080) argv.push('--port', String(DSH_WEB_HOST.port));
  if (DSH_WEB_HOST.host !== '127.0.0.1') argv.push('--host', DSH_WEB_HOST.host);

  const os = require('os');
  const tag = 'foxai-dsh-web-' + Date.now() + '-' + process.pid + '-' +
    Math.floor(Math.random() * 1e6).toString(36);
  const outLog = path.join(os.tmpdir(), tag + '.out.log');
  const errLog = path.join(os.tmpdir(), tag + '.err.log');
  let outFd = -1, errFd = -1;
  try {
    outFd = fs.openSync(outLog, 'w');
    errFd = fs.openSync(errLog, 'w');
  } catch (e) {
    return { ok: false, error: 'open tmp log 失败: ' + String((e && e.message) || e), argv: argv };
  }
  let child;
  try {
    child = require('child_process').spawn(argv[0], argv.slice(1), {
      detached: true,
      stdio: ['ignore', outFd, errFd],
      shell: IS_WIN,
      cwd: homeDir(),
      windowsHide: true,
    });
  } catch (e) {
    try { fs.closeSync(outFd); } catch (_) {}
    try { fs.closeSync(errFd); } catch (_) {}
    return { ok: false, error: 'spawn 失败: ' + String((e && e.message) || e), argv: argv };
  }
  child.unref();
  // 父进程关闭 fd;文件由子进程 fd 持有;子进程退出后日志仍可读
  try { fs.closeSync(outFd); } catch (_) {}
  try { fs.closeSync(errFd); } catch (_) {}
  return { ok: true, pid: child.pid, argv: argv, out_log: outLog, err_log: errLog };
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

// 在 auto-disable 流程里被调用:从 profile package.json 读 bundles,根据 stderr 识别
// 损坏条目,备份并移除。所有 IO/解析失败都返回 { tried: true, ok: false, error: ... }。
// 不直接抛异常,调用方根据返回值决定要不要继续重试。
// ---------- DSH 插件自愈（在 auto-disable 之前先尝试修复，治得好就不砍功能） ----------
// 两个已知的「插件本体没坏、只是安装形态不对」的故障模式：
//
// A. @openviking/dsh-memory-plugin 缺 shared/：上游 OpenViking#4773 起 shared/
//    改为 pack 时由 examples/memory-plugin-shared/sync.mjs 生成（.gitignore 覆盖、
//    git 里没有），而 dsh 的安装器从 GitHub 按文件逐个下载、没法跑生成器 →
//    client.mjs import ./shared/ov-http.mjs 直接 ERR_MODULE_NOT_FOUND。
//    自愈：从 pnpm-lock.yaml 读出锁定的 commit，浅取该 commit 的 checkout，
//    按「import 闭包」把 lib/ 里的模块拷进 shared/（与 sync.mjs 产物等价——
//    同样的闭包规则 + 同样的 GENERATED 头）。刻意不执行上游 sync.mjs 本身
//    （外部脚本不可信），闭包计算是本脚本自己的实现。
// B. bundle 目录名 ≠ 包真实名：如 maid-atelier 皮肤以
//    @dsh-external/dsh-client-ui-skin-maid-atelier 为依赖键安装（目录名），
//    但其 cordis.patch.yml 的 loader entry 用真实包名 @smalltailqwq/...，
//    Node 从 profile root 按真实名解析不到 → Cannot find package。
//    自愈：扫 node_modules 下 package.json name === 报错缺的包名的目录，
//    建 node_modules/<真实名> → <别名目录> 的 symlink。

function dshProfileDir() {
  return (process.env.DSH_PROFILE_DIR && process.env.DSH_PROFILE_DIR.trim()) ||
    path.join(homeDir(), '.dsh', 'profiles', 'web');
}

// 三种 import 形式的说明符提取（static from / dynamic import() / 副作用 import）。
// 与上游 sync.mjs 的三组正则保持一致，保证闭包结果一致。
const OV_STATIC_IMPORT_RE = /(?:^|[\s;(=])(?:import|export)\b[^;'"]*?from\s*["']([^"']+)["']/g;
const OV_DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const OV_SIDE_EFFECT_IMPORT_RE = /(?:^|[\s;])import\s*["']([^"']+)["']/g;
function srcImportSpecs(source) {
  const found = [];
  for (const re of [OV_STATIC_IMPORT_RE, OV_DYNAMIC_IMPORT_RE, OV_SIDE_EFFECT_IMPORT_RE]) {
    re.lastIndex = 0;
    let m; while ((m = re.exec(source))) found.push(m[1]);
  }
  return found;
}

// 同步递归收集源码文件（.mjs/.js/.cjs/.ts/.mts），跳过 node_modules/.git/shared
function ovSourceFilesUnder(dir, skipAbs, out2) {
  out2 = out2 || [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out2; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git' || p === skipAbs) continue;
      ovSourceFilesUnder(p, skipAbs, out2);
      continue;
    }
    const dot = e.name.lastIndexOf('.');
    if (dot > 0 && /\.(mjs|js|cjs|ts|mts)$/.test(e.name.slice(dot))) out2.push(p);
  }
  return out2;
}

// shared/ 目录在 lib/ 里的传递闭包（只跟随 lib 内部的 ./ 相对 import）
function ovSharedClosure(libDir, seeds) {
  const generated = new Set();
  const pending = seeds.slice();
  while (pending.length) {
    const name = pending.pop();
    if (generated.has(name)) continue;
    let body = null;
    try { body = fs.readFileSync(path.join(libDir, name), 'utf8'); } catch (_) {}
    if (body === null) continue; // lib/ 没有 = 插件本地模块，不生成（同 sync.mjs）
    generated.add(name);
    for (const spec of srcImportSpecs(body)) {
      if (spec.indexOf('./') === 0) pending.push(spec.slice(2));
    }
  }
  return Array.from(generated).sort();
}

function gitSync(args, timeoutMs) {
  return spawnSync('git', args, { encoding: 'utf8', timeout: timeoutMs || 120000, maxBuffer: 16 * 1024 * 1024 });
}

// 自愈 A：重建 @openviking/dsh-memory-plugin 的 shared/ 目录
function healOvSharedDir(profileDir) {
  const res = { ran: false, ok: false, healed: [], error: '', commit: '' };
  const pluginDir = path.join(profileDir, 'node_modules', '@openviking', 'dsh-memory-plugin');
  if (!fs.existsSync(pluginDir)) return res; // 插件本身没装，不属于本模式
  res.ran = true;

  // 从 pnpm-lock.yaml 解析锁定的 commit（git dep 的 resolution 行）。
  // 两种格式都要认：pnpm-lock v9 的 packages 条目把 tarball URL 与插件名写在同一行
  //   '@openviking/dsh-memory-plugin@https://codeload.github.com/volcengine/OpenViking/tar.gz/<sha>#path:/examples/dsh-memory-plugin':
  // 旧格式则是 `#<sha>&path:` 查询参数形态。解析不到就不盲修——用错 commit 生成的
  // shared/ 可能与已装版本不匹配。
  const lockPath = path.join(profileDir, 'pnpm-lock.yaml');
  let commit = '';
  try {
    const lock = fs.readFileSync(lockPath, 'utf8');
    const m = lock.match(/@openviking\/dsh-memory-plugin@[^\n]*?\/tar\.gz\/([0-9a-f]{40})[^\n]*#path:/) ||
              lock.match(/@openviking\/dsh-memory-plugin@[^'"\n]*?#([0-9a-f]{40})&path:/);
    if (m) commit = m[1];
  } catch (_) {}
  if (!commit) { res.error = '无法从 pnpm-lock.yaml 解析 openviking 锁定 commit'; return res; }
  res.commit = commit;

  // checkout 复用：同 commit 已取过就直接用（HEAD 校验），否则浅取一次。
  // fetch 先按用户 git 配置走（可能配了代理），失败再试「清空代理直连」——
  // 常见翻车：V2rayN 类代理没开但 git 全局配置还指着 127.0.0.1:10808。
  const work = path.join(require('os').tmpdir(), 'foxai-ov-sync-' + commit.slice(0, 10));
  const headProbe = gitSync(['-C', work, 'rev-parse', 'HEAD'], 10000);
  if (String(headProbe.stdout || '').trim() !== commit) {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) {}
    let r = gitSync(['init', '-q', work]);
    if (r.error || r.status !== 0) { res.error = 'git init 失败: ' + String((r.stderr || r.error || '')).trim(); return res; }
    gitSync(['-C', work, 'remote', 'add', 'origin', 'https://github.com/volcengine/OpenViking']);
    const fetchArgs = ['-C', work, 'fetch', '--depth', '1', '-q', 'origin', commit];
    r = gitSync(fetchArgs, 300000);
    if (r.error || r.status !== 0) {
      out('    · git fetch 按用户代理配置失败，改试直连…');
      r = gitSync(['-C', work, '-c', 'http.proxy=', '-c', 'https.proxy=',
        '-c', 'http.https://github.com/.proxy='].concat(fetchArgs.slice(2)), 300000);
    }
    if (r.error || r.status !== 0) {
      res.error = 'git fetch OpenViking@' + commit.slice(0, 7) + ' 失败: ' +
        String((r.stderr || r.error || '')).trim().split('\n').slice(-2).join(' ');
      return res;
    }
    r = gitSync(['-C', work, 'checkout', '-q', 'FETCH_HEAD']);
    if (r.error || r.status !== 0) { res.error = 'git checkout 失败: ' + String((r.stderr || '')).trim(); return res; }
  }

  const srcPluginDir = path.join(work, 'examples', 'dsh-memory-plugin');
  const libDir = path.join(work, 'examples', 'memory-plugin-shared', 'lib');
  if (!fs.existsSync(srcPluginDir) || !fs.existsSync(libDir)) {
    res.error = 'checkout 缺少 examples/dsh-memory-plugin 或 memory-plugin-shared/lib'; return res;
  }

  // seeds：插件自身代码里所有解析进 shared/ 的相对 import（含 servers/、测试）
  const sharedDir = path.join(srcPluginDir, 'shared');
  const seeds = [];
  for (const file of ovSourceFilesUnder(srcPluginDir, sharedDir)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const spec of srcImportSpecs(src)) {
      if (spec.indexOf('.') !== 0) continue;
      const resolved = path.resolve(path.dirname(file), spec);
      if (resolved.indexOf(sharedDir + path.sep) !== 0) continue;
      seeds.push(resolved.slice(sharedDir.length + 1));
    }
  }
  const closure = ovSharedClosure(libDir, Array.from(new Set(seeds)).sort());
  if (!closure.length) { res.error = '闭包为空（异常，未生成任何文件）'; return res; }

  const destShared = path.join(pluginDir, 'shared');
  const HEADER = '// GENERATED FROM examples/memory-plugin-shared/lib. DO NOT EDIT.\n';
  fs.mkdirSync(destShared, { recursive: true });
  for (const name of closure) {
    const target = path.join(destShared, name);
    const body = fs.readFileSync(path.join(libDir, name), 'utf8');
    // 经临时文件 + rename 落盘，读者不会看到半个模块（同 sync.mjs）
    const staging = target + '.' + process.pid + '.tmp';
    fs.writeFileSync(staging, HEADER + body, 'utf8');
    fs.renameSync(staging, target);
    // 语法自检：上游 lib/ 若真有语法问题，这里拦下来而不是让 dsh 报更难懂的错
    const chk = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8', timeout: 15000 });
    if (chk.error || chk.status !== 0) {
      res.error = '生成后语法自检失败: ' + name;
      return res;
    }
    res.healed.push(name);
  }
  res.ok = true;
  return res;
}

// 自愈 B：为「loader entry 用真实包名、目录却按依赖键装」的包补 symlink
function healBundleNameMismatch(profileDir, errText) {
  const res = { ran: false, ok: false, healed: [], error: '' };
  const missing = [];
  const re = /Cannot find package '([^']+)' imported from/g;
  let m; while ((m = re.exec(errText))) missing.push(m[1]);
  if (!missing.length) return res;
  res.ran = true;

  const nm = path.join(profileDir, 'node_modules');
  if (!fs.existsSync(nm)) { res.error = 'node_modules 不存在'; return res; }

  // name → 安装目录 的倒排索引（只扫 scope 一层 + 包一层，读 package.json 的 name）。
  // 目录判定同时接受符号链接：pnpm 布局下 node_modules 顶层全是 symlink，Dirent
  // 的 isDirectory() 对其返回 false，只认真目录会扫不到任何包（readFileSync 会
  // 自动跟随 symlink，坏链接在 try/catch 里跳过）。
  const byName = {};
  let scopes;
  try { scopes = fs.readdirSync(nm, { withFileTypes: true }); } catch (e) { res.error = String((e && e.message) || e); return res; }
  for (const e of scopes) {
    if (!(e.isDirectory() || e.isSymbolicLink()) || e.name.indexOf('.') === 0) continue;
    if (e.name.indexOf('@') === 0) {
      let subs; try { subs = fs.readdirSync(path.join(nm, e.name), { withFileTypes: true }); } catch (_) { continue; }
      for (const s of subs) {
        if (!(s.isDirectory() || s.isSymbolicLink()) || s.name.indexOf('.') === 0) continue;
        try {
          const pj = JSON.parse(fs.readFileSync(path.join(nm, e.name, s.name, 'package.json'), 'utf8'));
          if (pj.name && !byName[pj.name]) byName[pj.name] = path.join(nm, e.name, s.name);
        } catch (_) {}
      }
    } else {
      try {
        const pj = JSON.parse(fs.readFileSync(path.join(nm, e.name, 'package.json'), 'utf8'));
        if (pj.name && !byName[pj.name]) byName[pj.name] = path.join(nm, e.name);
      } catch (_) {}
    }
  }

  for (const name of Array.from(new Set(missing))) {
    const linkPath = path.join(nm, name);
    if (fs.existsSync(linkPath)) continue; // 已能解析，不动
    const target = byName[name];
    if (!target) continue; // node_modules 里确实没有此名：真缺失，交给 auto-disable/用户
    try {
      fs.mkdirSync(path.dirname(linkPath), { recursive: true });
      // Windows 无开发者模式时 symlink 需要管理员权限，junction 不需要（但只接受绝对路径）
      if (IS_WIN) fs.symlinkSync(target, linkPath, 'junction');
      else fs.symlinkSync(path.relative(path.dirname(linkPath), target), linkPath);
      res.healed.push({ link: name, target: path.relative(nm, target) });
    } catch (e) {
      res.error = '建 symlink 失败 ' + name + ': ' + String((e && e.message) || e);
      return res;
    }
  }
  res.ok = !res.error;
  return res;
}

// 自愈编排：按 stderr 特征触发 A/B；治好任意一项且无失败即视为成功（调用方会重启 dsh web 复核）
function trySelfHealDshPlugins(errText) {
  const result = { tried: false, ok: false, error: '', healed: [] };
  const profileDir = dshProfileDir();
  if (!fs.existsSync(profileDir)) return result;
  const steps = [];

  // A：报错点名 dsh-memory-plugin 且缺的是 shared/ 下的模块
  if (/dsh-memory-plugin/.test(errText) && /shared\/[A-Za-z0-9._-]+\.mjs/.test(errText)) {
    const r = healOvSharedDir(profileDir);
    if (r.ran) {
      result.tried = true;
      steps.push(r);
      if (r.healed.length) out('    🔧 自愈: 重建 @openviking/dsh-memory-plugin/shared/（' + r.healed.length + ' 个模块，commit ' + r.commit.slice(0, 7) + '）');
      if (!r.ok) { result.error = result.error || ('openviking shared/: ' + r.error); out('    ✗ 自愈 openviking shared/ 失败: ' + r.error); }
    }
  }

  // B：Cannot find package '<名>' imported from <profile root>
  const r2 = healBundleNameMismatch(profileDir, errText);
  if (r2.ran) {
    result.tried = true;
    steps.push(r2);
    for (const h of r2.healed) out('    🔧 自愈: node_modules/' + h.link + ' -> ' + h.target + '（loader 名不匹配）');
    if (!r2.ok) { result.error = result.error || ('bundle 名不匹配: ' + r2.error); out('    ✗ 自愈 bundle 名不匹配失败: ' + r2.error); }
  }

  for (const s of steps) for (const h of s.healed) result.healed.push(h.file || h.link || h);
  // 只要治好任意一项就视为可重试（error 保留为信息性）：多插件同时损坏时经常
  // B 治好 symlink 而 A 因网络失败——此时直接放弃会把本可保留的插件也禁用掉。
  // 重启复核后仍然坏的条目由下一轮（rounds 预算内）的 heal/auto-disable 接手。
  result.ok = result.tried && result.healed.length > 0;
  return result;
}

function tryAutoDisableBrokenDshBundles(errText) {
  const result = { tried: true, ok: false, error: '', detected: [], disabled: [], backup: '', profile: '' };
  const profileDir = (process.env.DSH_PROFILE_DIR && process.env.DSH_PROFILE_DIR.trim()) ||
    path.join(homeDir(), '.dsh', 'profiles', 'web');
  const pkgPath = path.join(profileDir, 'package.json');
  result.profile = pkgPath;
  if (!fs.existsSync(pkgPath)) {
    result.error = 'profile package.json 不存在: ' + pkgPath;
    out('    · 自动禁用跳过: ' + result.error);
    return result;
  }
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); }
  catch (e) { result.error = 'package.json 解析失败: ' + String((e && e.message) || e); return result; }
  const bundles = pkg && pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles;
  if (!Array.isArray(bundles)) {
    result.error = 'package.json 缺少 dsh.profile.bundles 数组';
    return result;
  }
  const broken = detectBrokenDshBundles(errText, bundles);
  result.detected = broken;
  if (broken.length === 0) {
    result.ok = true; // 探测正常完成,只是没匹配
    result.error = 'no-match';
    out('    · 自动禁用: stderr 未指向 bundles 里的任何条目,跳过修改');
    return result;
  }
  const fix = disableBrokenDshBundlesInProfile(broken);
  if (!fix.ok) {
    result.error = fix.error || 'unknown';
    return result;
  }
  result.ok = true;
  result.disabled = fix.disabled;
  result.backup = fix.backup_path;
  out('    🔧 检测到 ' + broken.length + ' 个损坏 bundle,已从 bundles 移除:');
  for (const b of fix.disabled) out('       - ' + b);
  out('         备份: ' + fix.backup_path);
  out('         恢复: cp "' + fix.backup_path + '" "' + pkgPath + '"');
  return result;
}

function launchDshWebAndWait(rounds) {
  // rounds = 剩余「自愈/自动禁用 + 重启复核」轮次预算，默认 3；每重试一轮消耗 1，
  // 归零后不再触发自愈/禁用——天然防死循环。多个插件连环损坏时（实测 maid-atelier
  // 名字不匹配 + openviking shared/ 缺失同时出现）单轮治不完，需要逐轮消解。
  if (rounds === undefined) rounds = 3;

  const r = launchDshWeb();
  if (!r.ok) {
    out('    ✗ 启动失败: ' + (r.error || 'unknown'));
    return Object.assign({ bound: false }, r);
  }
  out('    · 已 spawn (pid ' + r.pid + ')，等待端口 bind（最多 60s，npx 首次下载依赖可能较慢）…');
  const bound = waitForBind(DSH_WEB_HOST.host, DSH_WEB_HOST.port, 60000);
  if (!bound) {
    // dump 子进程 stderr/stdout 给用户看;再判断子进程是否已退出,给出可操作建议。
    // 匹配/自愈用全文（errFull）: 多插件损坏时错误按加载顺序全部打出,取尾部会
    // 把排在前面的报错截掉（实测 maid-atelier 的报错排在 openviking 前面,
    // tail 4KB 只剩 openviking,导致 symlink 自愈与 bundle 检测全部漏检）。
    // 展示仍用尾部 4KB 控制输出量。
    const alive = isProcessAlive(r.pid);
    const errFull = readLogTail(r.err_log, 256 * 1024);
    const errText = errFull.slice(-4096);
    const outText = readLogTail(r.out_log, 2048);
    out('    ! 60s 内端口未 bind' + (alive ? '' : '（子进程 pid ' + r.pid + ' 已退出）'));
    out('    [DEBUG] pid=' + r.pid + ' alive=' + alive + ' errLen=' + errFull.length + ' pattern=' + /failed to (?:apply|import) loader entry|Cannot find (?:module|package)/i.test(errFull));
    if (errText) {
      out('    --- dsh web stderr (尾部) ---');
      out(indentLines(errText, '    '));
    }
    if (outText) {
      out('    --- dsh web stdout (尾部) ---');
      out(indentLines(outText, '    '));
    }
    // 先自愈（重建 openviking shared/、修 loader 名不匹配 symlink）——治得好
    // 就不用禁用插件砍功能；自愈没改动任何文件或失败才走 auto-disable。
    // rounds>0 时才触发，每轮重试消耗预算，归零即止，无死循环。
    if (AUTO_DISABLE_DSH_BROKEN && rounds > 0 && !alive &&
        /failed to (?:apply|import) loader entry|Cannot find (?:module|package)/i.test(errFull)) {
      const heal = trySelfHealDshPlugins(errFull);
      if (heal.tried && heal.ok) {
        const retried = launchDshWebAndWait(rounds - 1);
        return Object.assign({ bound: false, self_healed: heal }, retried);
      }
      // 自动禁用损坏 bundle（仅在 enabled 时 + 子进程已退出 + stderr 含 loader 失败信号）
      const fix = tryAutoDisableBrokenDshBundles(errFull);
      if (fix && fix.tried && fix.ok) {
        const retried = launchDshWebAndWait(rounds - 1);
        return Object.assign({ bound: false, auto_disabled: fix }, retried);
      } else if (fix && fix.tried) {
        out('    ✗ 自动禁用失败: ' + (fix.error || 'unknown'));
        if (!/ERR_MODULE_NOT_FOUND|Cannot find (module|package)|failed to import loader entry|loader entries failed to apply/i.test(errFull)) {
          out('       stderr 未识别为插件加载失败,改用通用建议:');
        }
      }
    }
    if (/ERR_MODULE_NOT_FOUND|Cannot find (module|package)|failed to import loader entry|loader entries failed to apply/i.test(errFull)) {
      out('    💡 看起来是 ~/.dsh/profiles/web 下插件加载失败（模块缺失/损坏）');
      out('       修复: cd ~/.dsh/profiles/web && pnpm install');
      out('       或在该目录跑 npm update 把所有 plugin 升到最新兼容版本');
      if (!AUTO_DISABLE_DSH_BROKEN) {
        out('       或加 --auto-disable-dsh-plugins 让脚本自动从 bundles 移除损坏条目（备份原文件）');
      }
    } else if (!alive) {
      out('    💡 子进程已退出但 stderr 里没识别到常见错误模式；可手动跑同样的命令查看完整日志:');
      out('       ' + r.argv.join(' '));
    } else {
      out('    进程仍在跑但端口未 bind（npx 可能在下载依赖），稍后手动访问 ' + DSH_WEB_URL + ' 确认');
    }
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
    // dump stderr 让用户看到具体哪个插件挂了;匹配/自愈同样用全文（见上方 bound 分支注释）
    const errFull2 = readLogTail(r.err_log, 256 * 1024);
    const errText2 = errFull2.slice(-4096);
    if (errText2) {
      out('    --- dsh web stderr (尾部) ---');
      out(indentLines(errText2, '    '));
    }
    // 同样的「先自愈、后禁用」流程（端口先 bind 后立刻退出 = 子进程仍可读到 stderr）
    if (AUTO_DISABLE_DSH_BROKEN && rounds > 0 && errFull2 &&
        /failed to (?:apply|import) loader entry|Cannot find (?:module|package)/i.test(errFull2)) {
      const heal = trySelfHealDshPlugins(errFull2);
      if (heal.tried && heal.ok) {
        const retried = launchDshWebAndWait(rounds - 1);
        return Object.assign({ bound: true, stable: false, self_healed: heal }, retried);
      }
      const fix = tryAutoDisableBrokenDshBundles(errFull2);
      if (fix && fix.tried && fix.ok) {
        const retried = launchDshWebAndWait(rounds - 1);
        return Object.assign({ bound: true, stable: false, auto_disabled: fix }, retried);
      } else if (fix && fix.tried) {
        out('    ✗ 自动禁用失败: ' + (fix.error || 'unknown'));
      }
    }
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

// 构造 `npm install -g <pkg>@<ver>` 调用参数；allowScripts 非空且 npmMajor() >= 11
// 时附带 --allow-scripts=<pkg>（逗号分隔；npm 11.19 实证接受重复 flag 也接受逗号
// 合并值，这里走合并值更紧凑）。npm 10/9 没有这个 flag，传过去会被当成未知
// 选项拒绝 install，所以严格守卫主版本号。
function buildInstallArgs(pkgSpec, allowScripts) {
  const args = ['install', '-g', '--no-fund', '--no-audit'];
  if (Array.isArray(allowScripts) && allowScripts.length > 0 && npmMajor() >= 11) {
    args.push('--allow-scripts=' + allowScripts.join(','));
  }
  args.push(pkgSpec);
  return args;
}

// native binary 探测：返回 <NPM_ROOT>/<pkg>/<nativeBin> 的绝对路径。
// 仅在工具条目声明了 nativeBin 时调用（当前仅 grok 用到 bin/grok-native）。
// 用于捕获 npm 11 默认跳过 install scripts 但 npm 退出码仍为 0 的「假成功」——
// 调用方拿到路径后 fs.existsSync 决定是否重试一次。
function nativeBinPath(tool) {
  if (!tool || !tool.nativeBin) return '';
  try {
    return path.join.apply(null, [NPM_ROOT].concat(tool.pkg.split('/'), tool.nativeBin.split('/')));
  } catch (_) { return ''; }
}

// ---------- Node.js 运行时：版本检查 / 升级（--update-node） ----------
// 一键脚本带 --update-node：node 落后时按安装渠道尝试升级（nvm / brew / scoop /
// nvm-windows / winget），无法静默升级的渠道（官方 pkg / 发行版包）给手动指引；
// --check 或不带 flag 时只报告不改动。node 完全缺失时的引导安装在三个入口
// 脚本里（那时本脚本根本跑不起来），此处只管「已装但落后」的情况。
const UPDATE_NODE = process.argv.indexOf('--update-node') !== -1;

function nodeLatestVersion() {
  // `node` npm 包与 nodejs.org 同步发版；npm view 复用 npm 的代理/镜像配置，
  // CN 网络下比直连 nodejs.org 更稳
  const res = npm(['view', 'node', 'version'], 90000);
  if (res.error || res.status !== 0) return '';
  return String(res.stdout || '').trim().split('\n').pop().trim().replace(/^v/, '');
}

// 识别 node 安装渠道：realpath 解开 /usr/local/bin/node 这类符号链接后按路径特征判断
function nodeChannel() {
  let p = process.execPath;
  try { p = fs.realpathSync(p); } catch (_) {}
  const norm = String(p).replace(/\\/g, '/');
  if (norm.indexOf('/.nvm/') !== -1) return 'nvm';
  if (/homebrew|\/Cellar\//i.test(norm)) return 'brew';
  if (/scoop/i.test(norm)) return 'scoop';
  if (IS_WIN && /nvm/i.test(norm)) return 'nvm-windows';
  if (IS_WIN) return 'installer'; // Program Files\nodejs（MSI/winget 装的）
  return 'system';                // 官方 pkg(/usr/local) 或发行版包(/usr/bin)
}

function nodeRunTail(r) {
  return String((r && (r.stderr || r.stdout)) || '').trim().split('\n').slice(-3).join(' ').slice(0, 300);
}

function tryUpgradeNode(latest) {
  const res = { tried: true, ok: false, channel: nodeChannel(), error: '', note: '' };
  const fail = function (r) {
    res.error = (r && r.error && r.error.message) ? r.error.message : (nodeRunTail(r) || '退出码 ' + (r && r.status));
    return res;
  };
  if (res.channel === 'nvm') {
    const nvmDir = process.env.NVM_DIR || path.join(homeDir(), '.nvm');
    const nvmSh = path.join(nvmDir, 'nvm.sh');
    if (!fs.existsSync(nvmSh)) { res.error = '未找到 ' + nvmSh + '；请手动执行 nvm install ' + latest; return res; }
    const r = spawnSync('bash', ['-c',
      '. ' + JSON.stringify(nvmSh) + ' && nvm install ' + latest + ' && nvm alias default ' + latest],
      { encoding: 'utf8', timeout: 600000, maxBuffer: 16 * 1024 * 1024 });
    if (r.error || r.status !== 0) return fail(r);
    // 新版 bin 目录前置到本进程 PATH：后续 npm 调用、工具安装、版本探测都走新 node
    // （nvm 不改父进程 PATH，不前置的话本进程内仍全程旧版）
    const newBin = path.join(nvmDir, 'versions', 'node', 'v' + latest, 'bin');
    if (fs.existsSync(newBin)) process.env.PATH = newBin + path.delimiter + process.env.PATH;
    res.note = 'nvm 已安装 v' + latest + ' 并设为 default；本脚本内已切到新版，其它已开终端需重开';
    res.ok = true;
    return res;
  }
  if (res.channel === 'brew') {
    const r = run('brew', ['upgrade', 'node'], 600000);
    const combined = String(r.stderr || '') + String(r.stdout || '');
    // 「已是最新的 formula」也算成功（brew 版本可能滞后于 nodejs.org 最新）
    if ((r.error || r.status !== 0) && !/already installed|no such.*installed|nothing to upgrade/i.test(combined)) return fail(r);
    res.note = 'brew 渠道：已升到 brew formula 提供的版本（可能略滞后于 nodejs.org 最新）';
    res.ok = true;
    return res;
  }
  if (res.channel === 'scoop') {
    const r = run('scoop', ['update', 'nodejs'], 600000);
    if (r.error || r.status !== 0) return fail(r);
    res.ok = true;
    return res;
  }
  if (res.channel === 'nvm-windows') {
    const r1 = run('nvm', ['install', latest], 600000);
    if (r1.error || r1.status !== 0) return fail(r1);
    const r2 = run('nvm', ['use', latest], 60000);
    if (r2.error || r2.status !== 0) return fail(r2);
    res.ok = true;
    return res;
  }
  if (res.channel === 'installer') {
    const w = run('winget', ['--version'], 15000);
    if (w.error || w.status !== 0) {
      res.error = '本机无 winget；请从 https://nodejs.org 下载 MSI 安装 v' + latest;
      return res;
    }
    const r = run('winget', ['upgrade', '--id', 'OpenJS.NodeJS', '-e', '--silent',
      '--accept-package-agreements', '--accept-source-agreements'], 900000);
    if (r.error || r.status !== 0) return fail(r);
    res.ok = true;
    return res;
  }
  // system：官方 pkg(/usr/local) 或发行版包(/usr/bin)，免 sudo/免交互无法静默升级
  res.error = IS_WIN
    ? '该渠道无法静默升级；请从 https://nodejs.org 下载 MSI 覆盖安装 v' + latest
    : '官方 pkg/系统包渠道无法静默升级；推荐改用 nvm（curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash）或 brew（brew install node），或到 https://nodejs.org 下载新版 pkg';
  return res;
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

  // 校验 --only 子集:识别并拒绝拼写错的工具 id,避免静默成功。
  // 工具筛选:默认全集 = 非 optIn 工具(openclaw/hermes 等可选工具默认跳过,
  // 保证插件/CI 等非交互调用行为不变);--with 在默认全集上追加可选工具;
  // --only 显式点名时可包含可选工具。--only 与 --with 同时出现时 --only 优先。
  let filteredTools = TOOLS.filter(function (t) { return !t.optIn; });
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
  } else if (withSet && withSet.length > 0) {
    const knownIds = new Set(TOOLS.map(function (t) { return t.id; }));
    const unknown = withSet.filter(function (id) { return !knownIds.has(id); });
    if (unknown.length > 0) {
      out('✗ --with 包含未知工具 id: ' + unknown.join(', ') + '（合法值: ' + Array.from(knownIds).join(', ') + '）');
      process.exit(2);
    }
    filteredTools = TOOLS.filter(function (t) { return !t.optIn || withSet.indexOf(t.id) !== -1; });
  }

  const results = [];
  const summary = {};
  const bump = (s) => { summary[s] = (summary[s] || 0) + 1; };
  // 收集本次 upgrade/install 成功的工具 id，用于后续做环境变量恢复
  const envRestoreApps = new Set();
  // cc-switch-restore 只认 APP_TARGETS 里登记过的 app（claude/codex）；
  // 其它工具（如 dsh）没有对应的 CC Switch 配置，不进恢复列表
  const RESTORE_APPS = new Set(['claude', 'codex']);

  // ===== Node.js 运行时：先于工具表处理（node 是所有 CLI 的运行时底座）=====
  let nodeInfo = { skipped: true, reason: 'not-applicable' };
  {
    out('--------------------------------------------------------------');
    out('  … Node.js 运行时:');
    const cur = process.versions.node;
    const lat = nodeLatestVersion();
    const channel = nodeChannel();
    if (!lat) {
      nodeInfo = { status: 'unknown', installed: cur, latest: '-', channel: channel,
        action: '无法查询最新版本（npm view node 失败，检查网络）' };
      out('    ? ' + nodeInfo.action + '（当前 v' + cur + '，渠道: ' + channel + '）');
    } else if (verCmp(cur, lat) >= 0) {
      nodeInfo = { status: 'ok', installed: cur, latest: lat, channel: channel, action: '已是最新' };
      out('    ✓ 已是最新 v' + cur + '（渠道: ' + channel + '）');
    } else if (CHECK_ONLY || !UPDATE_NODE) {
      nodeInfo = { status: 'upgradable', installed: cur, latest: lat, channel: channel,
        action: '可升级 v' + cur + ' → v' + lat + (CHECK_ONLY ? '' : '（升级需 --update-node）') };
      out('    ! ' + nodeInfo.action + '（渠道: ' + channel + '）');
    } else {
      out('    … v' + cur + ' → v' + lat + '（渠道: ' + channel + '），正在升级 …');
      const up = tryUpgradeNode(lat);
      // 复核：PATH 上现在实际是哪个版本（nvm 已前置新版 bin；brew/安装器为原地覆盖）
      const bp = run('node', ['--version'], 30000);
      if (!bp.error && bp.status === 0) up.version_after = String(bp.stdout || '').trim().replace(/^v/, '');
      if (up.ok) {
        // node 升级可能改变 npm 前缀/自身版本：重算全局目录与主版本缓存，
        // 让后续工具检查/安装都基于新 node（本进程 PATH 已在 tryUpgradeNode 里处理）
        _npmMajorCache = null;
        NPM_ROOT = NPM_ROOT_OF();
        nodeInfo = { status: 'upgraded', installed: cur, latest: lat, channel: channel, upgrade: up,
          action: '已升级（详见上方说明）' };
        out('    ✓ ' + (up.note || '升级完成') + (up.version_after ? '，PATH 上现为 v' + up.version_after : ''));
      } else {
        bump('error');
        nodeInfo = { status: 'error', installed: cur, latest: lat, channel: channel, error: up.error,
          action: '升级失败' };
        out('    ✗ ' + up.error);
      }
    }
  }

  out(['工具'.padEnd(9), '状态'.padEnd(13), '当前版本'.padEnd(11), '最新版本'.padEnd(11), '操作'].join(''));
  out('--------------------------------------------------------------');

  for (const t of filteredTools) {
    // ensure-only 工具（herdr 等 brew 渠道）：只保证「装没装」，跳过下面整套
    // npm registry 比对/升级逻辑。已装 → ok；未装且有 brew → brew install；
    // 未装且无 brew → unknown（给出手动指引）。--check 模式只报告不动手。
    if (t.ensureOnly === 'brew') {
      let status = '', action = '', verFrom = '-', verTo = '-', err = '';
      const bp = binProbe(t.bin);
      if (bp.exists) {
        // `herdr --version` 首行是 "herdr 0.8.2"（带二进制名前缀），剥掉只留版本号
        const ver = (bp.version || '').replace(new RegExp('^' + t.bin + '\\s+'), '') || bp.version || '-';
        status = 'ok'; verFrom = ver;
        action = '已安装' + (ver !== '-' ? ' ' + ver : '') + '（仅确保安装，不监测升级）';
      } else {
        const brewOk = (function () {
          const r = run('brew', ['--version'], 15000);
          return !r.error && r.status === 0;
        })();
        if (!brewOk) {
          status = 'unknown';
          action = '未安装且本机无 Homebrew；请先安装 brew 再跑本脚本，或手动安装 ' + t.id;
        } else if (CHECK_ONLY) {
          status = 'installable';
          action = '未安装，将执行 brew install ' + t.id;
        } else {
          out('  … 正在安装 ' + t.name + ' (brew install ' + t.id + ')');
          const res = run('brew', ['install', t.id], 600000);
          if (!res.error && res.status === 0) {
            const bp2 = binProbe(t.bin);
            status = 'installed'; verTo = bp2.exists ? (bp2.version || '-') : '-';
            action = '已安装' + (verTo !== '-' ? ' ' + verTo : '');
          } else {
            status = 'error'; action = 'brew install 失败';
            err = sanitize(String(res.error ? res.error.message : (res.stderr || res.stdout || '')).trim().split('\n').slice(-2).join(' '));
          }
        }
      }
      bump(status);
      const icon0 = { ok: '✓', installable: '!', installed: '↑', unknown: '?' }[status] || '✗';
      out([t.id.padEnd(9), (icon0 + ' ' + status).padEnd(13), String(verFrom).padEnd(11), String(verTo).padEnd(11), action].join(''));
      if (err) out('          错误详情: ' + err);
      results.push({ id: t.id, name: t.name, status: status, installed: verFrom, latest: verTo, action: action, error: sanitize(err) });
      continue;
    }

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
        const res = npm(buildInstallArgs(t.pkg + '@' + target, t.allowScripts), 600000);
        // native binary 自愈：npm 11+ allow-scripts 默认拦截未在白名单的 install scripts，
        // 静默跳过 postinstall 但 npm 退出码仍为 0 — 装完看不到 native binary 即失败。
        // 重试一次（同样的 buildInstallArgs 已带 --allow-scripts=...，等 npm 配置生效）。
        const nbPath = nativeBinPath(t);
        const nativeMissing = !!(nbPath && !fs.existsSync(nbPath));
        let final = res;
        let retried = false;
        if (nativeMissing && res.status === 0 && !res.error) {
          out('    ! native binary 未落盘（' + nbPath + '），postinstall 可能被拦截，重试一次');
          final = npm(buildInstallArgs(t.pkg + '@' + target, t.allowScripts), 600000);
          retried = true;
        }
        if (!final.error && final.status === 0) {
          status = 'installed'; verFrom = '-'; verTo = installedVersion(t.pkg) || target;
          action = '已安装 ' + verTo + (retried ? '（含 native binary 自愈重试）' : '');
          if (RESTORE_APPS.has(t.id)) envRestoreApps.add(t.id);
        } else {
          status = 'error'; action = '安装失败';
          err = extractErr(final, t, { nativeMissing: retried || nativeMissing });
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
      const res = npm(buildInstallArgs(t.pkg + '@' + target, t.allowScripts), 600000);
      // 同 install 分支:native binary 自愈重试,捕获 npm 11 allow-scripts 静默跳过 postinstall。
      const nbPath2 = nativeBinPath(t);
      const nativeMissing2 = !!(nbPath2 && !fs.existsSync(nbPath2));
      let final2 = res;
      let retried2 = false;
      if (nativeMissing2 && res.status === 0 && !res.error) {
        out('    ! native binary 未落盘（' + nbPath2 + '），postinstall 可能被拦截，重试一次');
        final2 = npm(buildInstallArgs(t.pkg + '@' + target, t.allowScripts), 600000);
        retried2 = true;
      }
      if (!final2.error && final2.status === 0) {
        status = 'upgraded'; verTo = installedVersion(t.pkg) || target;
        action = (down ? '已回退 ' : '已升级 ') + cur + ' → ' + verTo + (retried2 ? '（含 native binary 自愈重试）' : '');
        if (RESTORE_APPS.has(t.id)) envRestoreApps.add(t.id);
      } else {
        status = 'error'; action = (down ? '回退失败' : '升级失败') + '（仍为 ' + cur + '）';
        err = extractErr(final2, t, { nativeMissing: retried2 || nativeMissing2 });
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
      node_js: nodeInfo,
      results: results,
      summary: summary,
      env_restore: envRestore,
      pi_extensions: piExt,
      dsh_web: dshWeb,
    }));
  }
  process.exit((summary.error || 0) > 0 ? 1 : 0);
}

function extractErr(res, t, opts) {
  opts = opts || {};
  if (res.error) {
    if (res.error.code === 'ETIMEDOUT') return '执行超时';
    return res.error.message || String(res.error);
  }
  const tail = String(res.stderr || res.stdout || '').trim().split('\n').slice(-3).join(' ');
  let base;
  if (/EACCES|permission denied/i.test(tail)) base = eaccHint(t.pkg) + ' | ' + tail;
  else base = tail || ('npm 退出码 ' + res.status);

  // 仅对声明了 allowScripts/nativeBin 的工具:装了但 native binary 没落盘,
  // 大概率是 npm 11+ allow-scripts 安全门把 postinstall 拒了。给出两条路:
  // (a) 一次性 npm config set (永久白名单) (b) 手动 npm install 时显式带 flag。
  if (opts.nativeMissing && t && t.allowScripts && t.allowScripts.length > 0) {
    const list = t.allowScripts.join(',');
    base += ' | npm 11+ allow-scripts 默认拒绝未在白名单的 install scripts；请运行: ' +
      'npm config set allow-scripts=' + list + ' --location=user ' +
      '或在 npm install -g 时显式附带 --allow-scripts=' + list;
  }
  return base;
}

main();
