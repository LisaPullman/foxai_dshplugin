# CC Switch 路由配置 · 本机网络拓扑与修复记录

> 初版：2026-09-27；最近核验：2026-10-09（CC Switch 4.0.4，macOS）。维护：主会话（Claude Code）。本文档记录本机多 AI 会话的网络路由现状与修复过程，供新会话/新机器排障使用。
> ⚠️ **脱敏声明**：CC Switch 数据库（`~/.cc-switch/cc-switch.db`）内含各 provider 的 API 密钥与 WebDAV 密码，**一律不入库、不打印、不写入本文档**（参见会话记忆 webdav-password-leaked：读 settings/DB 前先确认不回显凭据）。本文档只记录拓扑、端口、路由与验证方法。`~/.cc-switch/` 整体在仓库外，不受版本控制。

---

## 1. 拓扑总览（2026-10-09 实测）

```
[Codex CLI]      ← 当前唯一被本地代理接管的客户端
        │           （~/.codex/config.toml: openai_base_url = http://127.0.0.1:15721/v1）
        ▼
[CC Switch 本地代理 127.0.0.1:15721]   ← provider 路由/故障转移/协议转换
        │  出站全局代理 global_proxy_url =
        │  socks5://127.0.0.1:10808（2026-09-27 修复写入；4.0.4 实测仍生效）
        ▼
[xray 127.0.0.1:10808]           ← v2rayN（macOS 版）核心：SOCKS5 与 HTTP CONNECT 双协议
        │                        （直连国内分流 / 国际走节点）
        ▼
[上游 Provider：chatgpt.com（Codex/OpenAI Official）等]

[Claude Code] → 直连 https://open.bigmodel.cn/api/anthropic（智谱 GLM，
                env 写在 ~/.claude/settings.json；claude 应用位 takeover 当前关闭，
                不经 15721 / 10808）
```

**不经 CC Switch 的流量**：Claude Code 主会话直连智谱（国内可达）；git 推拉 GitHub 直连被 TLS 黑洞，须走 10808（`http://` 或 `socks5://` 均可，见会话记忆 v2rayn-proxy-git-setup）。

## 2. 路由表（2026-10-09 生效）

| 客户端 | 入口 | 上游 | 出站路径 | 状态 |
|---|---|---|---|---|
| Codex CLI（OpenAI Official OAuth） | 127.0.0.1:15721 `/v1` | `https://chatgpt.com` | CC Switch → socks5://10808 → xray | ✅ |
| Claude Code（智谱 GLM） | — 直连 | `open.bigmodel.cn/api/anthropic` | 国内直连 | ✅ 不依赖代理（claude 位 takeover 关） |
| WebDAV 配置同步（坚果云） | CC Switch 内置 | `dav.jianguoyun.com` | 国内直连分流 | ✅ |
| git origin（github.com/LisaPullman/foxai_dshplugin） | — | GitHub | `127.0.0.1:10808`（混合端口） | ✅ |

## 3. 2026-09-27 504 事故与修复记录（历史存档）

**现象**：Codex 会话报 `504 Gateway Timeout: CC Switch local proxy failed ... Provider: OpenAI Official; model: gpt-6-astra; 上游请求超时`，每 ~20 s 重试一次持续失败。

**根因**（逐层实测定位，时为 CC Switch 3.20.4）：
1. Codex → CC Switch（15721）链路正常（端口监听 + 接管状态在）
2. 本机直连 `chatgpt.com` / `api.openai.com` 全部超时（12–20 s，TLS 黑洞）
3. CC Switch 出站**未配置任何代理**（DB `proxy_config` 表无出站代理字段，`settings` 表无 `global_proxy_url` 键）→ 裸直连 → 必死
4. xray（10808）本身正常：走它 1.5–1.7 s 即可达上游

**修复**：
```
备份   ~/.cc-switch/cc-switch.db → ~/.cc-switch/backups/cc-switch.db.pre-proxy-fix-20260927-192707（仍在）
写入   settings 表：global_proxy_url = socks5://127.0.0.1:10808
        （exe 内对应命令 get_global_proxy_url / set_global_proxy_url / test_proxy_url / scan_local_proxies；
          设置界面「全局代理」可改可测）
重启   cc-switch
验证   日志 ~/.cc-switch/logs/cc-switch.log 出现
       [GlobalProxy] Initialized: socks5://127.0.0.1:10808   ← 修复前四次启动均为 direct connection
```

**2026-10-09 升级 4.0.4 后核验**：
- `providers`（含 `is_current`）与 `settings` 表 schema 未变，`global_proxy_url` 仍在且当日 `[GlobalProxy] Initialized` 日志正常 → 上述修复在 v4 无需重做
- v4 新增 `proxy_config` 表（app_type 限 `claude/codex/gemini/grokbuild`，仍是同一 15721；存 per-app 开关/超时/熔断参数），**出站代理仍只认 `settings.global_proxy_url`**，与 §3 根因描述一致
- 当前 per-app 接管状态（`proxy_config.enabled`）：codex=1（接管中），claude/gemini/grokbuild=0
- 升级方式为 brew cask（`auto_updates` 自更新，收据版本可能滞后于实际 app 版本，属预期）

## 4. 端口与进程对照（macOS）

| 端口 | 进程 | 用途 |
|---|---|---|
| 127.0.0.1:15721 | `cc-switch`（/Applications/CC Switch.app） | 本地多协议代理（claude/codex/gemini/grokbuild 四应用位共用） |
| 127.0.0.1:10808 | `xray`（~/Library/Application Support/v2rayN/bin/xray/xray） | 出站混合端口（SOCKS5 + HTTP CONNECT 双协议实测 200） |

## 5. 验证命令组（排障先跑这个；macOS）

```bash
# ⓪ 一键状态（推荐）：global_proxy_url 存在性 + 15721/10808 双端口 + 最近 [GlobalProxy] 日志
node foxai_update/scripts/cc-switch-proxy-setup.js status

# ① xray 活着且 10808 监听
lsof -nP -iTCP:10808 -sTCP:LISTEN

# ② 代理可用性（两种协议任一返回 200 即通）
curl -sS -m 10 -x http://127.0.0.1:10808 -o /dev/null -w "%{http_code}\n" https://github.com
curl -sS -m 10 -x socks5h://127.0.0.1:10808 -o /dev/null -w "%{http_code}\n" https://chatgpt.com   # 预期 403（无凭据正常）

# ③ CC Switch 代理已生效（看最近一次启动）
grep -a "GlobalProxy" ~/.cc-switch/logs/cc-switch.log | tail -1
#    期望 Initialized: socks5://... ；若是 direct connection → 走
#    node foxai_update/scripts/cc-switch-proxy-setup.js apply   （自动备份+写 DB+重启，可 rollback）

# ④ CC Switch 本地代理端口在听
lsof -nP -iTCP:15721 -sTCP:LISTEN
```

> 初版的 `netstat -ano | grep LISTENING` 是 Windows 命令，macOS 的 netstat 无 `-o` 选项会直接报错，已全部换为 `lsof`。

## 6. 故障排查表

| 症状 | 逐层检查 | 处置 |
|---|---|---|
| Codex 504 上游超时 | ①→②→③ | 多为 ③ 变回 direct（DB 被同步覆盖）或 ① xray 没起；修复走 `cc-switch-proxy-setup.js apply`（自动备份，`rollback --from-backup` 可回滚） |
| 切换代理节点后仍不通 | ① 看 xray 是否存活 | 节点切换后核心没起来是高发问题；没起可 `node foxai_update/scripts/cc-switch-proxy-setup.js xray-up` |
| 大文件下载截断但退出码 0 | 节点质量劣化 | 换节点 / 循环重试 |
| 不支持 socks5 的工具（vcpkg 内置 curl 等） | — | 用 `http://127.0.0.1:10808` 形式（混合端口兼容） |
| CC Switch 配置被 WebDAV 同步还原 | ③ 检查 + 重写 global_proxy_url | 2026-10-09 升级 4.0.4 后实测该键保留；复发就 apply 重做 §3 |
| Claude Code 升级后启动报无凭据 | 看 `~/.claude/settings.json` 的 env 段 | `foxai_update/scripts/update-cli-tools.js` 升级后自动从 DB 恢复（`cc-switch-restore.js`）；手动路径：进 CC Switch GUI 对当前 provider 点「应用」 |

## 7. 相关文档与工具

- `foxai_update/scripts/cc-switch-proxy-setup.js` — status / verify / apply / rollback / xray-up（DB 备份在 `~/.cc-switch/backups/`）
- `foxai_update/scripts/cc-switch-restore.js` — CLI 升级后 env 自愈恢复（`update-cli-tools.js` 自动调用）
- 会话记忆（本机 Claude Code memory）：`cc-switch-proxy-state-20260927`（含 4.0.4 追记）、`v2rayn-proxy-git-setup`、`webdav-password-leaked-20260927`

> 初版引用的根 `CLAUDE.md` §安全、根 `README.md` §🛰️ 代理经验、`Tianying/Reports/README_Recovery_Guide_Draft.md`、会话记忆 `ty-cc-switch-proxy` 在本机均已不存在，已从引用中移除（2026-10-09）。
