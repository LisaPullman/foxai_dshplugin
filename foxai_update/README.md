# foxai_update — AI CLI 工具检查/安装/升级（DSH 插件 + 开机一键脚本）

检查并维护 8 款 AI CLI 编码工具，未安装的自动通过 npm 全局安装（herdr 走 brew），已安装的自动升级到最新版：

| id | 工具 | npm 包 | 二进制 |
| --- | --- | --- | --- |
| `claude` | Claude Code | `@anthropic-ai/claude-code` | `claude` |
| `codex` | Codex CLI | `@openai/codex` | `codex` |
| `gemini` | Gemini CLI | `@google/gemini-cli` | `gemini` |
| `opencode` | OpenCode | `opencode-ai` | `opencode` |
| `pi` | Pi | `@earendil-works/pi-coding-agent` | `pi` |
| `grok` | Grok CLI | `@xai-official/grok` | `grok` |
| `dsh` | DeepSeek Harness | `@deepseek-ai/dsh` | `dsh` |
| `herdr` | Herdr | —（brew 渠道，ensure-only 不查升级） | `herdr` |

另有两款**可选工具**（默认跳过，仅一键脚本询问 y/n 答应或显式 `--with` 点名时才安装并升级）：

| id | 工具 | npm 包 | 二进制 |
| --- | --- | --- | --- |
| `openclaw` | OpenClaw | `openclaw` | `openclaw` |
| `hermes` | Hermes Agent | `hermes-agent` | `hermes` |

升级后还会自动做三类自愈：

1. **CC Switch 环境变量恢复** — claude 升级后从 `~/.cc-switch/cc-switch.db` 读当前激活 provider 的 env 段，写回 `~/.claude/settings.json`（含 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` 等），避免 Claude 升级后环境变量丢失导致启动失败
2. **Pi extensions 检查/升级** — 自动扫描 `~/.pi/agent/npm/` 下的 user packages（pi-mcp-adapter / pi-subagents / pi-web-access / pi-wechat-assistant 等），升级时调 `pi update --all` 一并处理 pi 自身 + 所有 extensions
3. **DSH web 升级/重启** — dsh（版本受兼容性 pin 管控，见「自愈 3」）升级后接管其 web UI（全局 `dsh` 二进制，默认 `http://127.0.0.1:3080`）的生命周期：一键脚本默认 kill 旧进程并用新版重启；未运行则直接启动

**跨平台**：macOS / Linux / Windows 全支持（核心逻辑为纯 Node.js，无 bash 依赖）。

## 架构

```
scripts/update-cli-tools.js   ★ 核心逻辑（升级 8 款 CLI + 2 款可选 + DSH web 接管）
scripts/cc-switch-restore.js ★ CC Switch 环境变量恢复（升级后自愈）
scripts/lib/tcp-probe.js      ★ TCP 探活子进程（DSH web 探测用，独立事件循环）
        ↑                ↑
FoxAI一键检查更新.command   DSH 动态 Cordis 插件（plugin/host.js 内嵌这两个脚本）
foxai-update-linux.sh         ├─ 工具 foxai_cli_update（agent 可调用）
FoxAI一键检查更新.bat         └─ Web 结果卡片（plugin/client.js）
```

- 双击入口只是薄包装：定位目录 → `node scripts/update-cli-tools.js --restart-dsh-web` → 暂停窗口
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

全自动：可选工具确认（是否安装并升级 OpenClaw / Hermes Agent，答 `y` 纳入、回车或 `n` 跳过）→ 检查 → 缺失的安装 → 落后的升级 → 显示汇总表 → 按回车关闭。可把入口文件做替身放到桌面/Dock。

#### 1.1) npm 11+ allow-scripts 说明（仅影响 grok）

grok CLI（`@xai-official/grok`）的 `postinstall` 会从 `@xai-official/grok-<plat>-<arch>` 解压 141MB 的 native binary `bin/grok-native`，跳过它 `grok` 命令直接不可用。npm 11 引入了 `allow-scripts` 安全门——不在白名单的 install scripts 会被静默跳过。本插件对 grok 的安装/升级会自动附带 `--allow-scripts=@xai-official/grok` 并在事后探测 native binary 是否落盘，缺失则自动重试一次。如果你手动跑 `npm install -g @xai-official/grok@<ver>`，需要自行附带该 flag，或一次性加入 npm 配置：`npm config set allow-scripts=@xai-official/grok --location=user`。

### 2) 核心脚本直接调用

```bash
node scripts/update-cli-tools.js                  # 检查并自动安装/升级
node scripts/update-cli-tools.js --check          # 只看报告，不做任何改动
node scripts/update-cli-tools.js --only pi,claude # 只处理子集
node scripts/update-cli-tools.js --with openclaw,hermes # 额外纳入可选工具（默认跳过）
node scripts/update-cli-tools.js --json           # 末尾追加 ##JSON## 行（机器可读）
node scripts/update-cli-tools.js --launch-dsh-web  # 升级后确保 DSH web 在跑（没跑则启动）
node scripts/update-cli-tools.js --restart-dsh-web # DSH web 在跑则 kill 后重启，没跑则启动
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
| `tools` | string[] | 只处理这些 id（默认全部 8 个；可选工具 openclaw/hermes 需在此点名才会处理） |
| `restart_dsh_web` | boolean | `true` 时若 DSH web 已在运行，先 kill 进程再用升级后的版本重启（默认 `false`，仅确保启动） |

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
    by_app: { claude: { status: 'restored', provider: '智谱', envKeys: 13 } }
  },
  pi_extensions: {         // Pi extensions 检查/升级
    skipped: false,
    upgrade: {
      ok: true,
      elapsed_ms: 6008,
      results: [{ name: 'pi-mcp-adapter', status: 'ok', ... }]
    }
  },
  dsh_web: {               // DSH web 生命周期接管
    action: 'restarted',   // launched / restarted / detected-running / detected-not-running /
                           // skipped-self-in-dsh-gui / restart-no-pid / kill-error / port-still-busy
    running: true, bound: true, stable: true,
    url: 'http://127.0.0.1:3080', port: 3080,
    killed_pid: 2499, pid: 22201, pid_source: 'ps-scan',
    ancestors_killed: []   // 顺带清理的 npm exec 包装进程
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
| `grok` | —（不参与） | Grok CLI 自带 `grok login` OAuth 认证，不在恢复范围内 |

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

## 自愈 3：DSH web 升级/重启

dsh（DeepSeek Harness）作为第 7 款工具走 npm 检查/升级（版本受 pin 管控，见上）；升级完成后接管其 web UI（全局 `dsh` 二进制，默认 `http://127.0.0.1:3080`，可用环境变量 `DSH_WEB_URL` 覆盖，如 `DSH_WEB_URL=http://127.0.0.1:9090`）的生命周期：

**版本锁定（pin）**：dsh 的目标版本受 `TOOLS` 注册表里的 `pin: '0.1.1-rc.2'` 管控——`0.1.2-rc.1` 移除了 `@deepseek-ai/dsh-settings` 的 `settingsNamespace` 导出，`~/.dsh/profiles/web` 的插件生态（`@linxin666/dsh-web-ui-all@0.3.6` 的 `web-ui-settings` 入口依赖它）尚未跟进，dsh web 会在 bind 端口后 2~8s 内崩溃（浏览器 `ERR_CONNECTION_REFUSED`）。因此：装了高版本的会**自动回退**到 pin；`--check` 显示 `已锁定 0.1.1-rc.2（latest … 因兼容性暂缓）`。启动用全局二进制而非 `npx -y`（npx 每次解析 registry latest，会绕开 pin）。上游插件适配后删除 pin 字段即恢复追最新。

**行为矩阵**：

| 场景 | 无 flag | `--launch-dsh-web` | `--restart-dsh-web` |
| --- | --- | --- | --- |
| 未运行 | 仅报告 | 启动新实例 | 启动新实例 |
| 已运行 | 仅报告，不动它 | 仅报告，不动它 | **kill 旧进程 → 等端口释放 → 重启** |

一键脚本（`.command` / `.bat` / `.sh`）默认带 `--restart-dsh-web`——每次一键更新都会把 DSH web 换成升级后的新版。DSH 插件的「立即更新」默认只带 `--launch-dsh-web`（没跑才启动）；`restart_dsh_web: true` 才 kill 重启。

**实现要点**：

- 探活：独立子进程 `scripts/lib/tcp-probe.js` 做 TCP connect（主进程里同步等待会阻塞事件循环，socket 回调永远不触发，所以必须外移到子进程）；内嵌 `node -e` 运行的插件模式找不到该文件时退化为 lsof/netstat 端口占用判断
- 僵尸进程识别：等待端口期间事件循环被阻塞，libuv 收不到 SIGCHLD、不会 reap 已崩溃的 dsh 子进程——`kill(pid,0)` 对僵尸照样返回成功，`alive=true` 会挡住自愈/自动禁用（2026-09 实例：spawn 后 3s 崩溃，60s 后仍误报存活）。`isProcessAlive` 会读 Linux `/proc/<pid>/stat` 或 macOS `ps -o stat=` 识别 `Z` 状态
- 启动失败自愈（默认开启，`--no-auto-disable-dsh-plugins` 关闭）：崩溃 stderr **全文**匹配（只取尾部 4KB 会截掉排在前面的报错，多插件损坏时漏检），先自愈后禁用——
  1. **自愈 A**：`@openviking/dsh-memory-plugin` 的 `shared/` 缺失（GitHub 源 tarball 不含生成产物）→ 从 pnpm-lock 锁定 commit（兼容 `tar.gz/<sha>#path:` 与旧 `#<sha>&path:` 两种格式）浅取 OpenViking 仓库，重建 `shared/` 传递闭包
  2. **自愈 B**：loader 用真实包名 import、目录却按依赖别名装（如 `@smalltailqwq/…` 装在 `@dsh-external/…` 下）→ 补 `node_modules` symlink（扫描兼容 pnpm 的 symlink 布局）
  3. **自动禁用**：自愈治不好才从 `dsh.profile.bundles` 移除 stderr 明确点名的条目（备份 `.bak.<ts>`，可 `cp` 回滚）；任意一项自愈成功即先重启复核，仍坏的条目由下一轮接手——轮次预算 3 轮，天然防死循环
- 进程定位：优先 lsof/netstat 找端口占用者（最准，识别自定义端口）；系统繁忙 lsof 超时（实测刚跑完 npm install 后可超 8s）时退回 `ps` 命令行扫描（`…/bin/dsh web` 本体与 `npm exec @deepseek-ai/dsh web` 包装器），双保险
- kill 策略：SIGTERM → 5s 宽限 → SIGKILL；随后向上清理 dsh 相关包装进程（`npm exec` 等），遇到用户 shell 立即停手
- 就绪复核：dsh 先 bind 端口、后加载 profile 插件——插件与新版本不兼容时会在就绪后数秒内退出（实测 0.1.2-rc.1 在 bind 后 2~8s 崩，单次 3s 复核抓不到），所以 bind 成功后轮询 ~15s 全程存活才报 `stable: true`
- 防自杀：沿 ppid 链检测本进程是否从 DSH GUI 内派生（Unix 用 `ps`，Windows 用 PowerShell `Get-CimInstance`）；是则跳过 kill，避免一键脚本杀掉正在使用的 GUI 会话
- 跨平台 sleep 用 `Atomics.wait`（不依赖 `/bin/sleep`，Windows 也可用）

## 平台兼容性

| 事项 | macOS | Linux | Windows |
| --- | --- | --- | --- |
| 核心（Node.js） | ✅ | ✅ | ✅（npm 经 `shell` 解析，兼容 `npm.cmd`） |
| 双击入口 | `.command` | `.sh` | `.bat` |
| DSH 插件 | ✅ `ctx.subprocess` + `node -e` 内嵌脚本（`-e` 参数约 28KB，低于 Windows 32K 参数上限，但继续增大时需留意） | ✅ | ✅ |
| 全局权限 | 默认前缀可写 | 若 EACCES，自动给出 `sudo` 或用户级 prefix（`npm config set prefix ~/.npm-global`）两种方案 | 默认前缀 `%APPDATA%\npm` 可写 |

## 常见问题

- **Claude Code 升级后「不能启动」**：通过 CC Switch 配智谱 GLM 路由的用户常遇到——Claude 升级覆盖 `~/.claude/settings.json`，把 env 段清空。本插件默认在升级后自动从 CC Switch DB 恢复（见上文「自愈 1」）。如果用的是 OpenAI 官方认证则不会被覆盖。
- **插件激活后工具没出现 / 调用报 subprocess 不可用**：宿主需挂载 `@deepseek-ai/dsh-subprocess-local`（`dsh-base` 标准组成）。工具会降级返回等价的手动命令，不会静默失败。
- **识别为 external**：说明该 CLI 是 brew/官方安装器装的。想交给本插件管理，先卸载原渠道版本（如 `brew uninstall gemini-cli`）再运行。
- **升级期间正在使用某 CLI**：npm 替换的是磁盘文件，已运行的进程不受影响，下次启动生效。
- **DSH web 重启后马上退出（`stable: false`）**：通常是 `~/.dsh/profiles/web` 下安装的第三方插件（如 `@linxin666/dsh-web-ui-all` 等 skin/面板类）与新版本 dsh 的 API 不兼容（2026-09 实例：`0.1.2-rc.1` 移除 `settingsNamespace` 导出导致 `web-ui-settings` 入口加载失败）。脚本已用 pin 锁在 `0.1.1-rc.2` 自动规避；若 pin 后仍失败，到该 profile 目录执行 `npm update` 升级插件后重跑一键脚本。插件**文件级损坏**（`shared/` 缺失、别名装包 loader 找不到）脚本会自动自愈或兜底禁用（见「实现要点·启动失败自愈」），无需手动处理。
- **为什么 DSH 插件里默认不 kill 重启**：插件本身跑在 DSH GUI 的会话里，kill web 进程会断掉当前会话；一键脚本（在普通终端双击运行）才是重启 DSH web 的推荐入口。
- **Pi extensions 在哪管理**：用 `pi install <npm pkg>` / `pi list` / `pi remove` 命令；本插件不安装新 extension（只升级已装的）。新装仍需走 `pi install`。

## 开发

```bash
node build.js            # 重新打包 dist/host-bundle.js + client-bundle.js（内嵌核心脚本 + 语法自检）
node build-cordis-args.js # 重新生成 dist/cordis-args.json
```

- `plugin/host.js`：DSH Host 代码（函数体形态；`__UPDATE_SCRIPT__` 占位符构建期替换）
- `plugin/client.js`：DSH Web 卡片（`React.createElement`，无 JSX——动态客户端代码不经编译）
- 修改核心逻辑只需改 `scripts/update-cli-tools.js`，然后重跑 `install.sh`
