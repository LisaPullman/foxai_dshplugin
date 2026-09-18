---
name: foxai-cli-update
description: 检查/安装/升级 8 款 AI CLI 编码工具（Claude Code、Codex CLI、Gemini CLI、OpenCode、Pi、Grok CLI、dsh、herdr），另可选装 OpenClaw / Hermes Agent。当用户想更新、升级、检查这些 CLI 的版本，或报怨某工具没装/过期时使用。核心脚本 node foxai_update/scripts/update-cli-tools.js，支持 --check（只看报告）与 --only（子集）、--with（追加可选工具）。
---

# FoxAI CLI 工具更新

维护 8 款 AI CLI：`claude` / `codex` / `gemini` / `opencode` / `pi` / `grok` / `dsh` / `herdr`（brew 渠道，npm 包映射见脚本内 TOOLS 注册表）；另有可选工具 `openclaw` / `hermes`（默认跳过，需 `--with openclaw,hermes` 或 `--only` 点名）。
核心脚本（唯一事实来源，跨 macOS/Linux/Windows）：
`<本仓库>/foxai_update/scripts/update-cli-tools.js`

| id | npm 包 |
| --- | --- |
| claude | @anthropic-ai/claude-code |
| codex | @openai/codex |
| gemini | @google/gemini-cli |
| opencode | opencode-ai |
| pi | @earendil-works/pi-coding-agent |
| grok | @xai-official/grok |
| dsh | @deepseek-ai/dsh（版本受 pin 管控） |
| herdr | —（brew 渠道） |
| openclaw（可选） | openclaw |
| hermes（可选） | hermes-agent |

## 执行流程

1. **先检查，向用户报告**：
   ```bash
   node foxai_update/scripts/update-cli-tools.js --check
   ```
   输出各工具 当前版本 / 最新版本 / 状态（ok / upgradable / installable / external / unknown）。

2. **确认意图后执行更新**（用户说「更新/升级」或明确同意时；「一键」场景可直接执行）：
   ```bash
   node foxai_update/scripts/update-cli-tools.js
   ```
   未安装的自动安装，落后的自动升级；结束后报告汇总。

3. **可选**：只处理部分工具 `--only pi,claude`；追加可选工具（OpenClaw / Hermes Agent）加 `--with openclaw,hermes`；机器可读结果加 `--json`（末尾 `##JSON##` 行）。

## 规则

- 状态为 `external` 的工具（brew/官方安装器渠道）**不要**强行 npm 安装，向用户说明双渠道冲突，由用户决定是否卸载原渠道。
- 状态为 `unknown`（网络不通）时不要反复重试，提示用户检查网络。
- Linux 下若失败详情含 EACCES，按脚本给出的提示转述两条方案：`sudo npm install -g <pkg>@latest` 或改用户级前缀 `npm config set prefix ~/.npm-global`（并把 `~/.npm-global/bin` 加入 PATH）。
- 用户问「开机一键」时，告知双击入口：macOS `FoxAI一键检查更新.command` / Windows `FoxAI一键检查更新.bat` / Linux `foxai-update-linux.sh`（均在 foxai_update/ 目录）。
