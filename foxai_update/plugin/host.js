// foxai_cli_update — DSH 动态 Cordis 插件 Host 代码
// 本文件是「函数体」形态：Cordis 把它作为 code.host 注入执行，
// 可用全局符号：harness、ctx（apply 时还会拿到 applyCtx）。
//
// 构建：build.js 会把 __UPDATE_SCRIPT__ 占位符替换为
// scripts/update-cli-tools.js（去注释后）的 JSON 字符串，
// 使插件自包含、不依赖仓库绝对路径，跨 macOS/Linux/Windows。
//
// 子进程通道：官方 ctx.subprocess 服务（@deepseek-ai/dsh-subprocess，
// 由 dsh-base 挂载的 local 提供方实现）。通过
// resolveExecutable('node') + spawn(['node', '-e', 脚本, '--', flags])
// 执行内嵌的核心脚本；npm 调用发生在子 Node 进程内，
// Windows 的 npm.cmd 由核心脚本的 shell 逻辑处理。

const UPDATE_SCRIPT = __UPDATE_SCRIPT__;

// 最近一次 apply 拿到的运行时上下文（execute 时用它访问 subprocess 服务）
let runtimeCtx = null;

function manualHint(flags) {
  return '手动执行等价命令: node <仓库>/foxai_update/scripts/update-cli-tools.js ' + flags.join(' ');
}

function tail(text, n) {
  const s = String(text || '');
  return s.length > n ? '…' + s.slice(-n) : s;
}

// 从脚本输出中解析 ##JSON## 行（取最后一行）
function parseJsonLine(text) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const idx = lines[i].indexOf('##JSON##');
    if (idx !== -1) {
      try {
        return JSON.parse(lines[i].slice(idx + 8));
      } catch (e) {
        return null;
      }
    }
  }
  return null;
}

// 读取 collect 模式 stdout/stderr（按偏移、不消费；兼容字符串/对象返回）
function readCollected(handle, stream) {
  try {
    const c = handle.collected && handle.collected[stream];
    if (!c || typeof c.readFrom !== 'function') return '';
    const r = c.readFrom(0);
    if (typeof r === 'string') return r;
    if (r && typeof r.text === 'string') return r.text;
    if (r && typeof r.data === 'string') return r.data;
    return r ? String(r) : '';
  } catch (e) {
    return '';
  }
}

// 取得 subprocess 服务（可能未挂载，逐级降级获取）
function getSubprocess() {
  if (!runtimeCtx) return null;
  try {
    if (typeof runtimeCtx.get === 'function') {
      const s = runtimeCtx.get('subprocess');
      if (s) return s;
    }
  } catch (e) { /* 服务未挂载 */ }
  try {
    if (runtimeCtx.subprocess) return runtimeCtx.subprocess;
  } catch (e) { /* 属性不可访问 */ }
  return null;
}

async function runUpdateScript(flags) {
  const sub = getSubprocess();
  if (!sub || typeof sub.resolveExecutable !== 'function' || typeof sub.spawn !== 'function') {
    return {
      success: false,
      error: 'subprocess 服务不可用（插件宿主未挂载 @deepseek-ai/dsh-subprocess-local）',
      hint: manualHint(flags),
    };
  }

  let nodeExe;
  try {
    nodeExe = await sub.resolveExecutable('node');
  } catch (e) {
    return { success: false, error: '未找到 node 可执行文件: ' + String((e && e.message) || e), hint: manualHint(flags) };
  }

  const argv = [nodeExe, '-e', UPDATE_SCRIPT, '--'].concat(flags);
  let handle;
  try {
    handle = sub.spawn({
      argv: argv,
      // cwd 是 subprocess 的必填字段——DSH SubprocessRuntime 直接把它透传给
      // node:child_process.spawn；缺省会抛 TypeError。这里用 DSH 会话的工作目录
      // （agent 进程上下文），让 npm 全局安装按用户预期的位置解析。
      cwd: runtimeCtx && runtimeCtx.cwd ? runtimeCtx.cwd : (process && process.cwd ? process.cwd() : '.'),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 4 * 1024 * 1024 },
        stderr: { maxBytes: 512 * 1024 },
      },
      // npm install -g 大包可能 > 30s,这里给 10 分钟超时,失败由 npm 自身
      // 给出非零退出码,subprocess 的 graceMs 只是终止升级链的窗口,不是脚本超时。
      graceMs: 10 * 60 * 1000,
    });
  } catch (e) {
    return { success: false, error: 'spawn 失败: ' + String((e && e.message) || e), hint: manualHint(flags) };
  }

  let done;
  try {
    done = await handle.done;
  } catch (e) {
    return { success: false, error: '进程未能启动: ' + String((e && e.message) || e), hint: manualHint(flags) };
  }

  const stdoutText = readCollected(handle, 'stdout');
  const stderrText = readCollected(handle, 'stderr');
  const parsed = parseJsonLine(stdoutText);
  if (parsed) {
    return Object.assign({ success: true, exit_code: done.exitCode, output_tail: tail(stdoutText, 1500) }, parsed);
  }
  return {
    success: false,
    exit_code: done.exitCode,
    error: '未能从脚本输出解析 ##JSON## 结果',
    output_tail: tail(stdoutText, 1500),
    stderr_tail: tail(stderrText, 800),
    hint: manualHint(flags),
  };
}

function defineUpdateTool() {
  return harness.defineTool({
    name: 'foxai_cli_update',
    description:
      '检查并安装/升级 7 款 AI CLI 编码工具（Claude Code、Codex CLI、Gemini CLI、OpenCode、Pi、Grok CLI、DeepSeek Harness）。' +
      '未安装的自动通过 npm 全局安装，已安装但有新版的自动升级到最新；非 npm 渠道（brew 等）安装的会识别并跳过；' +
      'dsh 版本受兼容性 pin 管控（当前锁 0.1.1-rc.2，高于 pin 的版本会被自动回退——0.1.2-rc.1 与 web profile 插件生态不兼容）。' +
      '执行更新时还会接管 DSH web（全局 dsh 二进制，默认 http://127.0.0.1:3080）：' +
      '未运行则启动；restart_dsh_web=true 时已运行则先 kill 再重启（从 DSH GUI 内调用会自动跳过 kill 以免自杀）。' +
      '默认执行更新；设置 check_only=true 则仅检查报告、不做任何改动。跨 macOS/Linux/Windows。',
    parameters: {
      type: 'object',
      properties: {
        check_only: {
          type: 'boolean',
          description: '仅检查并报告各工具状态，不安装/不升级（默认 false，即执行更新）',
          default: false,
        },
        tools: {
          type: 'array',
          items: { type: 'string', enum: ['claude', 'codex', 'gemini', 'opencode', 'pi', 'grok', 'dsh'] },
          description: '只处理这些工具（默认全部 7 个）',
        },
        restart_dsh_web: {
          type: 'boolean',
          description: '执行更新时若 DSH web 已在运行，先 kill 进程再用升级后的版本重启（默认 false，仅确保启动）',
          default: false,
        },
      },
      required: [],
    },
    async execute(args) {
      const a = args || {};
      const flags = [];
      if (a.check_only) flags.push('--check');
      if (Array.isArray(a.tools) && a.tools.length) flags.push('--only=' + a.tools.join(','));
      if (!a.check_only) {
        // GUI 内默认只「没跑才启动」（launch 安全）；kill+重启必须显式要求
        flags.push('--launch-dsh-web');
        if (a.restart_dsh_web) flags.push('--restart-dsh-web');
      }
      flags.push('--json');
      try {
        const res = await runUpdateScript(flags);
        if (res && res.summary && !res.check_only) {
          res.message = '已执行更新。汇总: ' + JSON.stringify(res.summary);
        } else if (res && res.summary) {
          res.message = '检查完成（未做改动）。汇总: ' + JSON.stringify(res.summary);
        }
        return res;
      } catch (err) {
        return { success: false, error: String((err && err.message) || err), hint: manualHint(flags) };
      }
    },
  });
}

// ---- 注册（与 foxai_sd25_video 相同的模式）----
const tool = defineUpdateTool();
const disposers = [];
disposers.push(harness.registerTool(ctx, tool));

return {
  inject: ['harness'],
  apply(applyCtx) {
    runtimeCtx = applyCtx;
    applyCtx.effect(function () {
      return function () {
        runtimeCtx = null;
        for (const d of disposers) {
          try { d(); } catch (e) {}
        }
      };
    });
    console.log('[foxai_cli_update] 已注册工具 foxai_cli_update（AI CLI 检查/安装/升级）');
  },
};
