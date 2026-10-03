#!/usr/bin/env node
// =============================================================
// foxai_update — AI CLI 编码工具 检查/安装/升级（跨平台：macOS / Linux / Windows）
// 管辖工具: claude code / codex cli / gemini cli / opencode / pi / grok /
//   herdr(brew)；另有可选工具(openclaw / hermes)，
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
  // 解压 native 二进制。npm 11+ 默认开启 allow-scripts 安全策略：未在白名单的 install
  // scripts 会被静默跳过——不传 --allow-scripts，postinstall 不跑，CLI 启动会找不到
  // native（解到一半就退出会留下损坏的二进制，更难排查）。
  // 这里列白名单后，install 调用会自动追加 --allow-scripts=<pkg>（buildInstallArgs）；
  // 装完后探测 nativeBin 是否就位，未就位则自动重试一次（捕获「白名单生效但仍失败」）。
  // native 落盘位置分平台：POSIX 是包内 bin/grok-native（141MB Mach-O/ELF，bin/grok
  // 符号链接指向它）；Windows 的 postinstall 对 win32 提前返回不做包内落盘，改写
  // $GROK_HOME（默认 ~/.grok）/bin/grok-<版本>.exe 再复制出 grok.exe——所以
  // nativeBinWin 用相对 grok home 的带版本路径（见 nativeBinPath）。
  { id: 'grok',     name: 'Grok CLI',    pkg: '@xai-official/grok',             bin: 'grok',
    allowScripts: ['@xai-official/grok'], nativeBin: 'bin/grok-native',
    nativeBinWin: 'bin/grok-<VERSION>.exe' },
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

// 一次 npm view 同时拿 dist-tag latest（data.version）与全部已发布版本（data.versions）。
// 解析失败/非 JSON（老 npm 输出格式、registry 异常）时返回 null，调用方退化为
// latestVersion 的旧行为。
function registryInfo(pkgName) {
  const res = npm(['view', pkgName, 'version', 'versions', '--json'], 90000);
  if (res.error || res.status !== 0) return null;
  try {
    const data = JSON.parse(String(res.stdout || '').trim());
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return {
      tag: data.version ? String(data.version) : '',
      versions: Array.isArray(data.versions) ? data.versions.map(String) : [],
    };
  } catch (e) { return null; }
}

// 镜像 dist-tag 防降级修正：npmmirror 等镜像的 dist-tag 同步可能滞后——实测
// @xai-official/grok 的 latest 停在 0.1.4 而同一镜像的版本列表已有 1.0.46，脚本
// 据此把「降级」当「升级」去装 0.1.4，还因该版本仅支持 darwin/arm64 直接
// EBADPLATFORM 失败。当已装版本比 latest 新时，改用版本列表里不小于已装版本的
// 最大稳定版（跳过 -beta 之类预发布）作目标；版本列表也拿不到更新的稳定版时
// 返回 ''，由调用方按「registry 落后」跳过而非降级。只在 latest 落后于已装版本
// 时介入，全新安装/正常追新的行为不变——不会把维护方故意压在 latest 之后的
// 候选版本推给用户。
function antiDowngradeTarget(cur, info) {
  if (!cur || !info || !info.versions.length) return '';
  let best = '';
  for (let i = 0; i < info.versions.length; i++) {
    const v = info.versions[i];
    if (!/^\d+(\.\d+)*$/.test(v)) continue; // 只有纯数字稳定版有资格
    if (verCmp(v, cur) < 0) continue;
    if (!best || verCmp(v, best) > 0) best = v;
  }
  return best;
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

// native binary 探测：返回装完后 native 应当所在的绝对路径，'' 表示未知。
// 仅在工具条目声明了 nativeBin 时调用（当前仅 grok）。POSIX 下是
// <NPM_ROOT>/<pkg>/<nativeBin>（postinstall 解压出的 bin/grok-native）；
// Windows 下声明了 nativeBinWin 的走 $GROK_HOME（默认 ~/.grok，与 grok 的
// bootstrap 保持一致）下带版本的文件（bin/grok-<版本>.exe）——探带版本的文件，
// 旧版残留的 grok.exe 不会把「postinstall 没跑」误判成成功。
// 用于捕获 npm 11 默认跳过 install scripts 但 npm 退出码仍为 0 的「假成功」——
// 调用方拿到路径后 fs.existsSync 决定是否重试一次。
function nativeBinPath(tool, targetVersion) {
  if (!tool || !tool.nativeBin) return '';
  try {
    if (IS_WIN && tool.nativeBinWin) {
      if (!targetVersion) return ''; // 模板路径没版本就没法探,视为未知
      const home = process.env.GROK_HOME
        || path.join(require('os').homedir(), '.grok');
      return path.join(home, tool.nativeBinWin.replace('<VERSION>', targetVersion));
    }
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
  // 只对 APP_TARGETS 登记过的 app 做 CC Switch 环境变量恢复
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
    const reg = registryInfo(t.pkg);
    const lat = (reg && reg.tag) ? reg.tag : latestVersion(t.pkg);
    // 目标版本：有 pin（兼容性锁，见 TOOLS 注册表注释）用 pin，否则 registry
    // latest。pin 是本地常量，即使网络拿不到 latest 也能照常比对/安装。
    // latest 落后于已装版本（镜像 dist-tag 滞后，见 antiDowngradeTarget 注释）
    // 时用版本列表里的最大稳定版修正目标，避免把降级当升级。
    let target = t.pin || lat;
    if (!t.pin && cur && lat && verCmp(lat, cur) < 0) {
      const fixed = antiDowngradeTarget(cur, reg);
      if (fixed) target = fixed;
    }
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
        const nbPath = nativeBinPath(t, target);
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
    } else if (!t.pin && verCmp(cur, target) > 0) {
      // 防降级护栏：无 pin 却要把已装版本换到更低版本 = registry 数据落后（镜像的
      // dist-tag 与版本列表都滞后，或上游回撤了 latest）。降级只会装出旧版甚至直接
      // 失败（如 grok 0.1.4 仅支持 darwin/arm64，Windows 上 EBADPLATFORM），
      // 按已最新处理并说明原因，等 registry 追上后再正常升级。
      status = 'ok';
      action = '已装 ' + cur + '，registry latest ' + target + ' 落后于已装版本，跳过（防降级）';
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
      const nbPath2 = nativeBinPath(t, target);
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
