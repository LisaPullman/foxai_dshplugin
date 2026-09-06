#!/usr/bin/env node
// =============================================================
// foxai_update — AI CLI 编码工具 检查/安装/升级（跨平台：macOS / Linux / Windows）
// 管辖工具: claude code / codex cli / gemini cli / opencode / pi
//
// 用法:
//   node update-cli-tools.js                    检查并自动安装/升级到最新
//   node update-cli-tools.js --check            只检查报告，不做任何改动
//   node update-cli-tools.js --json             末尾追加 ##JSON## 行（供插件解析）
//   node update-cli-tools.js --only pi,claude   只处理指定子集
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

  for (const t of filteredTools) {
    const cur = installedVersion(t.pkg);
    const lat = latestVersion(t.pkg);
    let status = '', action = '', verFrom = cur || '-', verTo = lat || '-', err = '';

    if (!lat) {
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
        action = '未安装，将安装 ' + lat;
      } else {
        out('  … 正在安装 ' + t.name + ' (' + t.pkg + '@' + lat + ')');
        const res = npm(['install', '-g', '--no-fund', '--no-audit', t.pkg + '@latest'], 600000);
        if (!res.error && res.status === 0) {
          status = 'installed'; verFrom = '-'; verTo = installedVersion(t.pkg) || lat;
          action = '已安装 ' + verTo;
          envRestoreApps.add(t.id);
        } else {
          status = 'error'; action = '安装失败';
          err = extractErr(res, t);
        }
      }
    } else if (cur === lat) {
      status = 'ok'; action = '已是最新';
    } else if (CHECK_ONLY) {
      status = 'upgradable'; action = '可升级 ' + cur + ' → ' + lat;
    } else {
      out('  … 正在升级 ' + t.name + ' ' + cur + ' → ' + lat);
      const res = npm(['install', '-g', '--no-fund', '--no-audit', t.pkg + '@latest'], 600000);
      if (!res.error && res.status === 0) {
        status = 'upgraded'; verTo = installedVersion(t.pkg) || lat;
        action = '已升级 ' + cur + ' → ' + verTo;
        envRestoreApps.add(t.id);
      } else {
        status = 'error'; action = '升级失败（仍为 ' + cur + '）';
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
      out('    ✗ Pi extensions 处理异常: ' + String((e && e.message) || e));
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
