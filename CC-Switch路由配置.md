# CC Switch 路由配置 · 本机网络拓扑与修复记录

> 日期：2026-09-27；维护：主会话（Claude Code）。本文档记录本机多 AI 会话的网络路由现状与修复过程，供新会话/新机器排障使用。
> ⚠️ **脱敏声明**：CC Switch 数据库（`~/.cc-switch/cc-switch.db`）内含各 provider 的 API 密钥与 WebDAV 密码，**一律不入库、不打印、不写入本文档**（遵守根 `CLAUDE.md` §安全）。本文档只记录拓扑、端口、路由与验证方法。`~/.cc-switch/` 整体在仓库外，不受版本控制。

---

## 1. 拓扑总览

```
[Codex CLI / Claude Code / Gemini CLI]          ← 被接管的 CLI 客户端
        │  http://127.0.0.1:15721/v1（CC Switch 本地代理，cc-switch.exe）
        ▼
[CC Switch 本地代理 127.0.0.1:15721]            ← provider 路由/故障转移/协议转换
        │  出站全局代理 global_proxy_url =
        │  socks5://127.0.0.1:10808（2026-09-27 修复写入）
        ▼
[xray.exe  127.0.0.1:10808]                     ← 混合端口：SOCKS5 与 HTTP CONNECT 双协议
        │                                        （直连国内分流 / 国际走节点）
        ▼
[上游 Provider：chatgpt.com（Codex/OpenAI Official）等]
```

**不经 CC Switch 的流量**：本仓库 Claude Code 主会话走 `.env` 的国内端点（智谱 open.bigmodel.cn / MiniMax api.minimaxi.com，直连可达）；git 推拉 GitHub 直连被 TLS 黑洞，须走 10808（`http://` 或 `socks5://` 均可）。

## 2. 路由表（当前生效）

| 客户端 | 入口 | 上游 | 出站路径 | 状态 |
|---|---|---|---|---|
| Codex CLI（gpt-6-astra，OpenAI Official OAuth） | 127.0.0.1:15721 `/v1/responses` | `https://chatgpt.com` | CC Switch → socks5://10808 → xray | ✅ 2026-09-27 修复 |
| Claude Code（CC Switch 接管的 claude 应用位） | 127.0.0.1:15721 | 当前 provider（DB `currentProviderClaude`） | 同上全局代理 | ✅ |
| 本仓库主会话（glm 等） | — | `.env` 国内双端点 | 直连 | ✅ 不依赖代理 |
| WebDAV 配置同步（坚果云） | CC Switch 内置 | `dav.jianguoyun.com` | 国内直连分流 | ✅ |
| git origin（github.com/foxbobby/QFTY） | — | GitHub | `127.0.0.1:10808`（混合端口） | ✅ |

## 3. 2026-09-27 504 事故与修复记录

**现象**：Codex 会话报 `504 Gateway Timeout: CC Switch local proxy failed ... Provider: OpenAI Official; model: gpt-6-astra; 上游请求超时`，每 ~20 s 重试一次持续失败。

**根因**（逐层实测定位）：
1. Codex → CC Switch（15721）链路正常（端口监听 + 接管状态在）
2. 本机直连 `chatgpt.com` / `api.openai.com` 全部超时（12–20 s，TLS 黑洞）
3. CC Switch 3.20.4 出站**未配置任何代理**（DB `proxy_config` 表无出站代理字段，`settings` 表无 `global_proxy_url` 键）→ 裸直连 → 必死
4. xray（10808）本身正常：走它 1.5–1.7 s 即可达上游

**修复**：
```
备份   ~/.cc-switch/cc-switch.db → ~/.cc-switch/backups/cc-switch.db.pre-proxy-fix-20260927
写入   settings 表：global_proxy_url = socks5://127.0.0.1:10808
        （exe 内对应命令 get_global_proxy_url / set_global_proxy_url / test_proxy_url / scan_local_proxies；
          设置界面「全局代理」可改可测）
重启   cc-switch.exe
验证   日志 ~/.cc-switch/logs/cc-switch.log 出现
       [GlobalProxy] Initialized: socks5://127.0.0.1:10808   ← 修复前四次启动均为 direct connection
```

## 4. 端口与进程对照

| 端口 | 进程 | 用途 |
|---|---|---|
| 127.0.0.1:15721 | cc-switch.exe | 本地多协议代理（claude/codex/gemini/grokbuild 四应用位共用） |
| 127.0.0.1:10808 | xray.exe | 出站混合端口（SOCKS5 + HTTP CONNECT 双协议实测 200） |

## 5. 验证命令组（排障先跑这个）

```bash
# ① xray 活着且 10808 监听
netstat -ano | grep -E "10808.*LISTENING"

# ② 代理可用性（两种协议任一返回 200 即通）
curl -sS -m 10 --ssl-no-revoke -x http://127.0.0.1:10808 -o /dev/null -w "%{http_code}\n" https://github.com
curl -sS -m 10 -x socks5h://127.0.0.1:10808 -o /dev/null -w "%{http_code}\n" https://chatgpt.com   # 预期 403（无凭据正常）

# ③ CC Switch 代理已生效（看最近一次启动）
grep -a "GlobalProxy" ~/.cc-switch/logs/cc-switch.log | tail -1
#    期望 Initialized: socks5://... ；若是 direct connection → 重做 §3 修复

# ④ CC Switch 本地代理端口在听
netstat -ano | grep -E "15721.*LISTENING"
```

## 6. 故障排查表

| 症状 | 逐层检查 | 处置 |
|---|---|---|
| Codex/Claude 504 上游超时 | ①→②→③ | 多为 ③ 变回 direct（DB 被同步覆盖）或 ① xray 没起（v2rayN 里重启节点） |
| 切换代理节点后仍不通 | ① 看 xray.exe 是否存活 | 节点切换后核心没起来是高发问题（README §代理经验 #2） |
| 大文件下载截断但退出码 0 | 节点质量劣化 | 用磨下载器循环重试（README §代理经验 #5） |
| 不支持 socks5 的工具（vcpkg 内置 curl） | — | 用 `http://127.0.0.1:10808` 形式（混合端口兼容） |
| CC Switch 配置被 WebDAV 同步还原 | ③ 检查 + 重写 global_proxy_url | 同步不覆盖 settings 表该键的结论待观察；复发就重做 §3 |

## 7. 相关文档

- 根 `README.md` §🛰️ 网络与代理经验（2026-09-26 实战 8 条）
- `Tianying/Reports/README_Recovery_Guide_Draft.md` §4.2（新机代理注意事项）
- 会话记忆：`ty-cc-switch-proxy`（主会话私有，不入库）
