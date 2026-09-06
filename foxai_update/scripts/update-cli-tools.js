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
// 退出码: 0 = 无失败项   1 = 存在 error 项
// =============================================================

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const IS_WIN = process.platform === 'win32';

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
// 仅当 only 是字符串(可能为空)时建立 onlySet,null 表示未传 --only
const onlySet = OPTS.only === null ? null : OPTS.only.split(',').map(function (s) { return s.trim(); });

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
