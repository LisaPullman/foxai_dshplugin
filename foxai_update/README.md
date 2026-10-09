# foxai_update — AI CLI 工具检查/安装/升级（DSH 插件 + 开机一键脚本）

检查并维护 7 款 AI CLI 编码工具，未安装的自动安装（npm 全局；herdr 走 brew），已安装的自动升级到最新版：

| id | 工具 | npm 包 | 二进制 |
| --- | --- | --- | --- |
| `claude` | Claude Code | `@anthropic-ai/claude-code` | `claude` |
| `codex` | Codex CLI | `@openai/codex` | `codex` |
| `gemini` | Gemini CLI | `@google/gemini-cli` | `gemini` |
| `opencode` | OpenCode | `opencode-ai` | `opencode` |
| `pi` | Pi | `@earendil-works/pi-coding-agent` | `pi` |
| `grok` | Grok CLI | `@xai-official/grok` | `grok` |
| `herdr` | Herdr | —（brew 渠道，ensure-only 不查升级） | `herdr` |

另有两款**可选工具**（默认跳过，仅一键脚本询问 y/n 答应或显式 `--with` / `tools` 点名时才安装并升级）：

| id | 工具 | npm 包 | 二进制 |
| --- | --- | --- | --- |
| `openclaw` | OpenClaw | `openclaw` | `openclaw` |
| `hermes` | Hermes Agent | `hermes-agent` | `hermes` |

升级后还会自动做两类自愈：

1. **CC Switch 环境变量恢复** — claude/codex 升级后从 `~/.cc-switch/cc-switch.db` 读当前激活 provider 的 env 段，写回 `~/.claude/settings.json` 等目标文件（含 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` 等），避免升级后环境变量丢失导致启动失败
2. **Pi extensions 检查/升级** — 自动扫描 `~/.pi/agent/npm/` 下的 user packages（pi-mcp-adapter / pi-subagents / pi-web-access / pi-wechat-assistant 等），升级时调 `pi update --all` 一并处理 pi 自身 + 所有 extensions

> 2026-10-03 起 dsh（DeepSeek Harness）已移出管辖工具表（其 web 接管/自愈逻辑一并移除）；CC Switch 升级到 4.0.4 后 DB schema 实测兼容，上述恢复链路正常。

**跨平台**：macOS / Linux / Windows 全支持（核心逻辑为纯 Node.js，无 bash 依赖）。

## 架构

```
scripts/update-cli-tools.js   ★ 核心逻辑（升级 7 款 CLI + 2 款可选 + 两类自愈）
scripts/cc-switch-restore.js  ★ CC Switch 环境变量恢复（升级后自愈）
scripts/cc-switch-proxy-setup.js ★ CC Switch 全局代理配置/验证/回滚（排障用，主流程不调）
        ↑
FoxAI一键检查更新.command   DSH 动态 Cordis 插件（plugin/host.js 内嵌核心脚本）
foxai-update-linux.sh         ├─ 工具 foxai_cli_update（agent 可调用）
FoxAI一键检查更新.bat         └─ Web 结果卡片（plugin/client.js）
```

- 双击入口只是薄包装：定位目录 → Node.js 引导（缺失时自动安装）→ 可选工具分别 y/n 确认（OpenClaw / Hermes Agent）→ `node scripts/update-cli-tools.js --update-node` → 暂停窗口
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

全自动：Node.js 引导（缺失时自动安装，见 1.2）与版本升级（`--update-node`，渠道感知）→ 可选工具**分别**确认（OpenClaw、Hermes Agent 各问一次 y/n，答 `y` 纳入、回车或 `n` 跳过）→ 检查 → 缺失的安装 → 落后的升级 → 显示汇总表 → 按回车关闭。可把入口文件做替身放到桌面/Dock。

#### 1.1) npm 11+ allow-scripts 说明（仅影响 grok）

grok CLI（`@xai-official/grok`）的 `postinstall` 会从 `@xai-official/grok-<plat>-<arch>` 解压 141MB 的 native binary，跳过它 `grok` 命令直接不可用。npm 11 引入了 `allow-scripts` 安全门——不在白名单的 install scripts 会被静默跳过。本插件对 grok 的安装/升级会自动附带 `--allow-scripts=@xai-official/grok` 并在事后探测 native binary 是否落盘，缺失则自动重试一次。native 的落盘位置分平台：macOS/Linux 是包内 `bin/grok-native`（`bin/grok` 符号链接指向它）；Windows 的 postinstall 不写包内文件，改落到 `$GROK_HOME`（默认 `~/.grok`）的 `bin/grok-<版本>.exe`（再复制出 `grok.exe`），探测按平台取对应路径。如果你手动跑 `npm install -g @xai-official/grok@<ver>`，需要自行附带该 flag，或一次性加入 npm 配置：`npm config set allow-scripts=@xai-official/grok --location=user`。

#### 1.2) Node.js 引导与版本升级

入口脚本运行前先探测 Node.js：

- **缺失时自动引导安装** — macOS/Linux：brew 优先，无 brew 则从 npmmirror/nodejs.org 双源下载 tarball 装到 `~/.foxai/` 并把 bin 写入 shell profile 的 PATH（幂等）；Windows：winget 优先，无 winget 则查最新版下载 MSI 走安装向导（npmmirror/nodejs.org 双源）
- **已装但落后时自动升级**（核心脚本 `--update-node` 阶段）— 按安装渠道（realpath 识别）分流：nvm（`nvm install <latest>` + alias default，并把新版 bin 前置到本进程 PATH）、brew（`brew upgrade node`）、scoop、nvm-windows（`nvm install/use`）、MSI 渠道（`winget upgrade`）；官方 pkg（`/usr/local`）与发行版包等无法免 sudo 静默升级的渠道给出手动指引。升级成功后自动重算 npm 全局目录与 npm 主版本缓存，后续工具安装基于新 Node
- 直接调用核心脚本（含 DSH 插件路径）默认只**报告** Node 版本状态，不带 `--update-node` 不做改动

#### 1.3) 镜像 dist-tag 滞后防降级（grok 实例）

npmmirror 等镜像的 `latest` dist-tag 同步可能滞后：实测 `@xai-official/grok` 的 latest 停在 `0.1.4`，而同一镜像的版本列表已有 `1.0.46`（npmjs.org 的 latest 同为 `1.0.46`）。脚本若只看 dist-tag 会把「降级」当「升级」去装 `0.1.4`——该版本发布时仅支持 darwin/arm64，Windows 上直接 `EBADPLATFORM` 报「升级失败」。防护分两层：

- **目标版本修正** — 已装版本比 registry latest 新时，改用版本列表里不小于已装版本的最大**稳定版**（跳过 `-beta` 等预发布）作升级目标；只在 latest 落后于已装版本时介入，全新安装与正常追新行为不变（不会把维护方故意压在 latest 之后的候选版本推给用户）
- **防降级护栏** — 版本列表也拿不到更新的稳定版时（镜像整体滞后），按「已是最新」跳过并注明「registry latest 落后于已装版本」，绝不无 pin 降级

### 2) 核心脚本直接调用

```bash
node scripts/update-cli-tools.js                  # 检查并自动安装/升级
node scripts/update-cli-tools.js --check          # 只看报告，不做改动
node scripts/update-cli-tools.js --only pi,claude # 只处理子集
node scripts/update-cli-tools.js --with openclaw,hermes # 额外纳入可选工具（默认跳过）
node scripts/update-cli-tools.js --json           # 末尾追加 ##JSON## 行（机器可读）
node scripts/update-cli-tools.js --update-node    # Node.js 落后时按渠道升级（默认只报告）
node scripts/update-cli-tools.js --no-restore     # 跳过 CC Switch 环境变量恢复
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
| `tools` | string[] | 只处理这些 id（默认全部 7 款非可选工具；可选工具 openclaw/hermes 需在此点名才会处理） |

返回结构：

```js
{
  success: true,
  check_only: false,
  results: [{ id, name, status, installed, latest, action, error }],  // 各 CLI
  summary: { ok: 4, upgraded: 1 },
  output_tail: "...",      // 最后 1500 字符人类可读输出
  env_restore: {           // CC Switch 环境变量恢复
    skipped: false,
    by_app: { claude: { status: 'restored', provider: '智谱', envKeys: 16 } }
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

herdr 为 ensure-only：只保证「装没装」，已装即报 `ok`，不查 registry、不做版本监测（升级交给用户手动 `brew upgrade`）。

## 自愈 1：CC Switch 环境变量恢复

`scripts/cc-switch-restore.js` — 升级完 CLI 后从 [CC Switch](https://github.com/farion1231/cc-switch) 数据库读当前激活 provider 的 env 段，覆盖写回对应配置文件。

**用户场景**：通过 CC Switch 配智谱 GLM 路由（`ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic`、`ANTHROPIC_MODEL=glm-5.3[1M]` 等）的 env 写入 `~/.claude/settings.json`。Claude Code 升级有时会清空该文件，导致「Claude 不能启动」。本插件在升级后自动从 CC Switch 恢复这些 env，无需手动进 GUI 点「应用」。

| 工具 | 目标文件 | 备注 |
| --- | --- | --- |
| `claude` | `~/.claude/settings.json` | 合并 `env` 段，保留 `permissions` / `mcpServers` 等其他顶层 key |
| `codex` | `~/.codex/auth.json` | 兼容新旧两种 provider schema（`auth.OPENAI_*` / 旧 `apiKey`） |
| `opencode` / `gemini` / `pi` | 对应配置文件 | 当前用户未在 CC Switch 配置 is_current=1 provider，自动 `skipped` |
| `herdr` / `grok` | —（不参与） | 非 CC Switch 接管的配置；grok 自带 `grok login` OAuth 认证 |

**CC Switch 4.0.4 实测**（2026-10-09）：`providers`（含 `is_current`）与 `settings` 表 schema 与 3.x 一致，恢复链路正常；本机「智谱」provider 16 个 env 键恢复验证通过。

**跨平台**：
- macOS / Linux — 用系统 `sqlite3` CLI 读 DB（无需 npm 依赖）
- Windows — 大多无自带 sqlite3 CLI，优雅跳过（返回 `status: 'no-sqlite3'`），不报错
- 写入前自动备份原文件为 `<file>.foxup-backup-<ISO>`，可手动回滚

**降级行为**：
- CC Switch 未装（`~/.cc-switch/cc-switch.db` 不存在）→ `status: 'no-db'`，跳过
- is_current=1 provider 无 env 段（OpenAI Official 走 OAuth）→ `status: 'skipped'`，不算失败
- 配置文件损坏 → 备份为 `.foxup-corrupt-<ISO>` 后重建

**CLI flag**：`--no-restore` 跳过恢复步骤（高级用户手动管理 env 时）。

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

## 附：CC Switch 代理排障

与本更新器配套的 `scripts/cc-switch-proxy-setup.js`（主流程不调用，排障用）：`status` / `verify` / `apply`（备份+写 `global_proxy_url`+重启）/ `rollback` / `xray-up`。详见仓库根 `CC-Switch路由配置.md`。

## 平台兼容性

| 事项 | macOS | Linux | Windows |
| --- | --- | --- | --- |
| 核心（Node.js） | ✅ | ✅ | ✅（npm 经 `shell` 解析，兼容 `npm.cmd`） |
| 双击入口 | `.command` | `.sh` | `.bat` |
| DSH 插件 | ✅ `ctx.subprocess` + `node -e` 内嵌脚本（`-e` 参数约 30KB，已接近 Windows 32K 参数上限，继续增大时需留意） | ✅ | ✅ |
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
