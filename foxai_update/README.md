# foxai_update — AI CLI 工具检查/安装/升级（DSH 插件 + 开机一键脚本）

检查并维护 5 款 AI CLI 编码工具，未安装的自动通过 npm 全局安装，已安装的自动升级到最新版：

| id | 工具 | npm 包 | 二进制 |
| --- | --- | --- | --- |
| `claude` | Claude Code | `@anthropic-ai/claude-code` | `claude` |
| `codex` | Codex CLI | `@openai/codex` | `codex` |
| `gemini` | Gemini CLI | `@google/gemini-cli` | `gemini` |
| `opencode` | OpenCode | `opencode-ai` | `opencode` |
| `pi` | Pi | `@earendil-works/pi-coding-agent` | `pi` |

**跨平台**：macOS / Linux / Windows 全支持（核心逻辑为纯 Node.js，无 bash 依赖）。

## 架构

```
scripts/update-cli-tools.js   ★ 核心逻辑（唯一实现，纯 Node，跨平台）
        ↑                ↑
FoxAI一键检查更新.command   DSH 动态 Cordis 插件（plugin/host.js 内嵌该脚本）
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

返回 `{ success, results: [{id, name, status, installed, latest, action, error}], summary, output_tail }`。
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

## 平台兼容性

| 事项 | macOS | Linux | Windows |
| --- | --- | --- | --- |
| 核心（Node.js） | ✅ | ✅ | ✅（npm 经 `shell` 解析，兼容 `npm.cmd`） |
| 双击入口 | `.command` | `.sh` | `.bat` |
| DSH 插件 | ✅ `ctx.subprocess` + `node -e` 内嵌脚本（~7.5KB，远低于 32K 参数上限） | ✅ | ✅ |
| 全局权限 | 默认前缀可写 | 若 EACCES，自动给出 `sudo` 或用户级 prefix（`npm config set prefix ~/.npm-global`）两种方案 | 默认前缀 `%APPDATA%\npm` 可写 |

## 常见问题

- **插件激活后工具没出现 / 调用报 subprocess 不可用**：宿主需挂载 `@deepseek-ai/dsh-subprocess-local`（`dsh-base` 标准组成）。工具会降级返回等价的手动命令，不会静默失败。
- **识别为 external**：说明该 CLI 是 brew/官方安装器装的。想交给本插件管理，先卸载原渠道版本（如 `brew uninstall gemini-cli`）再运行。
- **升级期间正在使用某 CLI**：npm 替换的是磁盘文件，已运行的进程不受影响，下次启动生效。

## 开发

```bash
node build.js            # 重新打包 dist/host-bundle.js + client-bundle.js（内嵌核心脚本 + 语法自检）
node build-cordis-args.js # 重新生成 dist/cordis-args.json
```

- `plugin/host.js`：DSH Host 代码（函数体形态；`__UPDATE_SCRIPT__` 占位符构建期替换）
- `plugin/client.js`：DSH Web 卡片（`React.createElement`，无 JSX——动态客户端代码不经编译）
- 修改核心逻辑只需改 `scripts/update-cli-tools.js`，然后重跑 `install.sh`
