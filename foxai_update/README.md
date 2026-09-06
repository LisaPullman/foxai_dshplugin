# foxai_update — AI CLI 工具检查/安装/升级（DSH 插件 + 开机一键脚本）

检查并维护 5 款 AI CLI 编码工具，未安装的自动通过 npm 全局安装，已安装的自动升级到最新版：

| id | 工具 | npm 包 | 二进制 |
| --- | --- | --- | --- |
| `claude` | Claude Code | `@anthropic-ai/claude-code` | `claude` |
| `codex` | Codex CLI | `@openai/codex` | `codex` |
| `gemini` | Gemini CLI | `@google/gemini-cli` | `gemini` |
| `opencode` | OpenCode | `opencode-ai` | `opencode` |
| `pi` | Pi | `@earendil-works/pi-coding-agent` | `pi` |

升级后还会自动做两类自愈：

1. **CC Switch 环境变量恢复** — claude 升级后从 `~/.cc-switch/cc-switch.db` 读当前激活 provider 的 env 段，写回 `~/.claude/settings.json`（含 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` 等），避免 Claude 升级后环境变量丢失导致启动失败
2. **Pi extensions 检查/升级** — 自动扫描 `~/.pi/agent/npm/` 下的 user packages（pi-mcp-adapter / pi-subagents / pi-web-access / pi-wechat-assistant 等），升级时调 `pi update --all` 一并处理 pi 自身 + 所有 extensions

**跨平台**：macOS / Linux / Windows 全支持（核心逻辑为纯 Node.js，无 bash 依赖）。

## 架构

```
scripts/update-cli-tools.js   ★ 核心逻辑（升级 5 款 CLI）
scripts/cc-switch-restore.js ★ CC Switch 环境变量恢复（升级后自愈）
        ↑                ↑
FoxAI一键检查更新.command   DSH 动态 Cordis 插件（plugin/host.js 内嵌这两个脚本）
foxai-update-linux.sh         ├─ 工具 foxai_cli_update（agent 可调用）
FoxAI一键检查更新.bat         └─ Web 结果卡片（plugin/client.js）
```

- 双击入口只是薄包装：定位目录 → `node scripts/update-cli-tools.js` → 暂停窗口
- DSH 插件把核心脚本以字符串内嵌进 host bundle（自包含，不依赖仓库路径），
  通过官方 `ctx.subprocess` 服务 `spawn(node, ['-e', 脚本, '--', flags])` 执行，
  解析脚本输出的 `##JSON##` 行返回结构化结果

## 使用方式

### 1) 开机一键（不进 DSH）

| 系统 | 入口 | 说明 |
| --- | --- | --- |
| macOS | 双击 `FoxAI一键检查更新.command` | Terminal 自动打开执行；若被 Gatekeeper 拦截：右键 → 打开，或 `xattr -d com.apple.quarantine "FoxAI一键检查更新.command"` |
| Windows | 双击 `FoxAI一键检查更新.bat` | 需已安装 Node.js；UTF-8 输出（自动 `chcp 65001`） |
| Linux | `./foxai-update-linux.sh`（或文件管理器「在终端中运行」） | 需 `chmod +x`（本仓库已设好） |

全自动：检查 → 缺失的安装 → 落后的升级 → 显示汇总表 → 按回车关闭。可把入口文件做替身放到桌面/Dock。

### 2) 核心脚本直接调用

```bash
node scripts/update-cli-tools.js                  # 检查并自动安装/升级
node scripts/update-cli-tools.js --check          # 只看报告，不做任何改动
node scripts/update-cli-tools.js --only pi,claude # 只处理子集
node scripts/update-cli-tools.js --json           # 末尾追加 ##JSON## 行（机器可读）
```

### 3) DSH 插件（agent 调用）

构建 + 激活：

```bash
./install.sh        # macOS/Linux（Windows 用 install.bat）
# 1. 把 dist/cordis-args.json 的内容作为 cordis_define 工具的入参
# 2. 用返回的 pluginId / packageId 调用 cordis_run
# 3. 首次运行触发审批，确认后激活
```

激活后对 agent 说「检查并更新我的 AI CLI 工具」，agent 调用 `foxai_cli_update` 工具：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `check_only` | boolean | `true` 仅检查报告，不改动（默认 `false` 执行更新） |
| `tools` | string[] | 只处理这些 id（默认全部 5 个） |

返回结构：

```js
{
  success: true,
  check_only: false,
  results: [{ id, name, status, installed, latest, action, error }],  // 5 个 CLI
  summary: { ok: 4, upgraded: 1 },
  output_tail: "...",      // 最后 1500 字符人类可读输出
  env_restore: {           // CC Switch 环境变量恢复
    skipped: false,
    by_app: { claude: { status: 'restored', provider: '智谱', envKeys: 13 } }
  },
  pi_extensions: {         // Pi extensions 检查/升级
    skipped: false,
    upgrade: {
      ok: true,
      elapsed_ms: 6008,
      results: [{ name: 'pi-mcp-adapter', status: 'ok', ... }]
    }
  }
}
```

Web 端同时出现结果卡片：状态表 + 「检查更新」/「立即更新」按钮 + 执行输出折叠区。

## 状态说明

| 状态 | 含义 |
| --- | --- |
| `ok` | 已是最新 |
| `upgradable` / `installable` | 可升级 / 未安装（`--check` 模式的报告） |
| `upgraded` / `installed` | 已升级 / 已安装（执行模式的结果） |
| `external` | 二进制存在但非 npm 全局渠道（brew / scoop / 官方安装器），识别后跳过，避免双渠道冲突 |
| `unknown` | 无法查询 npm registry（多为网络问题），跳过 |
| `error` | 安装/升级失败（附错误详情） |

## 自愈 1：CC Switch 环境变量恢复

`scripts/cc-switch-restore.js` — 升级完 CLI 后从 [CC Switch](https://github.com/farion1231/cc-switch) 数据库读当前激活 provider 的 env 段，覆盖写回对应配置文件。

**用户场景**：通过 CC Switch 配智谱 GLM 路由（`ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic`、`ANTHROPIC_MODEL=glm-5.3[1M]` 等）的 env 写入 `~/.claude/settings.json`。Claude Code 升级有时会清空该文件，导致「Claude 不能启动」。本插件在升级后自动从 CC Switch 恢复这些 env，无需手动进 GUI 点「应用」。

| 工具 | 目标文件 | 备注 |
| --- | --- | --- |
| `claude` | `~/.claude/settings.json` | 合并 `env` 段，保留 `tui` / `permissions` 等其他顶层 key |
| `codex` | `~/.codex/auth.json` | codex 用 `auth.json` 而非 `config.toml` 存 API key |
| `opencode` / `gemini` / `pi` | 对应配置文件 | 当前用户未在 CC Switch 配置 is_current=1 provider，自动 `skipped` |

**跨平台**：
- macOS / Linux — 用系统 `sqlite3` CLI 读 DB（无需 npm 依赖）
- Windows — 大多无自带 sqlite3 CLI，优雅跳过（返回 `status: 'no-sqlite3'`），不报错
- 写入前自动备份原文件为 `<file>.foxup-backup-<ISO>`，可手动回滚

**降级行为**：
- CC Switch 未装（`~/.cc-switch/cc-switch.db` 不存在）→ `status: 'no-db'`，跳过
- is_current=1 provider 无 env 段（OpenAI Official 走 OAuth）→ `status: 'skipped'`，不算失败
- 配置文件损坏 → 备份为 `.foxup-corrupt-<ISO>` 后重建

**新增 CLI flag**：`--no-restore` 跳过恢复步骤（高级用户手动管理 env 时）。

## 自愈 2：Pi extensions 检查/升级

pi 在 `~/.pi/agent/npm/node_modules/` 下管理 user extensions，本插件在主流程结束后自动处理：

- **check 模式**：扫描 `~/.pi/agent/npm/package.json` 的 `dependencies`，对每个 extension 比对 `installed` vs `latest`
- **upgrade 模式**：调 `pi update --all`，由 pi 自己管理 `~/.pi/settings.json` 元数据；解析 stdout 中 `Updating npm:<pkg>...` 行 + 前后版本对比，把每个 extension 标记为 `upgraded` / `ok`

示例输出：

```
  … Pi extensions:
    extension               状态           当前版本       最新版本       操作
    pi-mcp-adapter          ✓ ok         2.32.1     2.32.1     已是最新
    pi-subagents            ✓ ok         0.65.1     0.65.1     已是最新
    pi-web-access           ✓ ok         0.28.0     0.28.0     已是最新
    pi-wechat-assistant     ↑ upgraded   0.3.1      0.3.1      已升级 0.1.0 → 0.3.1
```

降级后实测：先把 `pi-wechat-assistant` 用 `npm install pi-wechat-assistant@0.1.0 --prefix ~/.pi/agent/npm` 降到 0.1.0，跑本插件一次，自动恢复到 0.3.1。

## 平台兼容性

| 事项 | macOS | Linux | Windows |
| --- | --- | --- | --- |
| 核心（Node.js） | ✅ | ✅ | ✅（npm 经 `shell` 解析，兼容 `npm.cmd`） |
| 双击入口 | `.command` | `.sh` | `.bat` |
| DSH 插件 | ✅ `ctx.subprocess` + `node -e` 内嵌脚本（host bundle 约 22KB，远低于 32K 参数上限） | ✅ | ✅ |
| 全局权限 | 默认前缀可写 | 若 EACCES，自动给出 `sudo` 或用户级 prefix（`npm config set prefix ~/.npm-global`）两种方案 | 默认前缀 `%APPDATA%\npm` 可写 |

## 常见问题

- **Claude Code 升级后「不能启动」**：通过 CC Switch 配智谱 GLM 路由的用户常遇到——Claude 升级覆盖 `~/.claude/settings.json`，把 env 段清空。本插件默认在升级后自动从 CC Switch DB 恢复（见上文「自愈 1」）。如果用的是 OpenAI 官方认证则不会被覆盖。
- **插件激活后工具没出现 / 调用报 subprocess 不可用**：宿主需挂载 `@deepseek-ai/dsh-subprocess-local`（`dsh-base` 标准组成）。工具会降级返回等价的手动命令，不会静默失败。
- **识别为 external**：说明该 CLI 是 brew/官方安装器装的。想交给本插件管理，先卸载原渠道版本（如 `brew uninstall gemini-cli`）再运行。
- **升级期间正在使用某 CLI**：npm 替换的是磁盘文件，已运行的进程不受影响，下次启动生效。
- **Pi extensions 在哪管理**：用 `pi install <npm pkg>` / `pi list` / `pi remove` 命令；本插件不安装新 extension（只升级已装的）。新装仍需走 `pi install`。

## 开发

```bash
node build.js            # 重新打包 dist/host-bundle.js + client-bundle.js（内嵌核心脚本 + 语法自检）
node build-cordis-args.js # 重新生成 dist/cordis-args.json
```

- `plugin/host.js`：DSH Host 代码（函数体形态；`__UPDATE_SCRIPT__` 占位符构建期替换）
- `plugin/client.js`：DSH Web 卡片（`React.createElement`，无 JSX——动态客户端代码不经编译）
- 修改核心逻辑只需改 `scripts/update-cli-tools.js`，然后重跑 `install.sh`
