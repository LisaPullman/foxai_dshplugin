/**
 * foxai_vigener Web REST API 集成测试
 *
 * 启动 server.js → 调各路由 → 检查响应 → 关闭。
 * 不需要 FAL_KEY:重点验证 config / models / references / outputs 路由,
 * generate 路由在缺 key 时返回 400 + JSON 错误。
 *
 * 用法:node test/api.mjs
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "..", "server.js");
const PORT = 18788;
const BASE = `http://127.0.0.1:${PORT}`;

const step = (n, title) => console.log(`\n===== ${n}. ${title} =====`);
const ok = (cond, label) =>
  console.log(`  ${cond ? "✓" : "✗"} ${label}${cond ? "" : " — FAIL"}`);
let failures = 0;
const check = (cond, label) => {
  ok(cond, label);
  if (!cond) failures++;
};

async function waitForReady(child, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/config`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server 启动超时(${timeoutMs}ms)`);
}

// 启动服务
const child = spawn(process.execPath, [serverPath], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

try {
  await waitForReady(child);

  step(1, "GET /api/config");
  {
    const r = await fetch(`${BASE}/api/config`);
    check(r.status === 200, "HTTP 200");
    const j = await r.json();
    check(typeof j.hasFalKey === "boolean", "hasFalKey 字段");
    check(typeof j.modelCount === "number" && j.modelCount > 0, `modelCount=${j.modelCount}`);
  }

  step(2, "GET /api/models");
  {
    const r = await fetch(`${BASE}/api/models`);
    check(r.status === 200, "HTTP 200");
    const j = await r.json();
    check(j.count > 0, `count=${j.count}`);
    check(j.grouped?.image?.length > 0, "image 分组非空");
    check(j.grouped?.video?.length > 0, "video 分组非空");
    check(j.grouped?.audio?.length > 0, "audio 分组非空");
    check(typeof j.defaults === "object", "defaults 字段");
  }

  step(3, "GET /api/references");
  {
    const r = await fetch(`${BASE}/api/references`);
    check(r.status === 200, "HTTP 200");
    const j = await r.json();
    check(Array.isArray(j.files), "files 字段是数组");
  }

  step(4, "GET /api/outputs");
  {
    const r = await fetch(`${BASE}/api/outputs`);
    check(r.status === 200, "HTTP 200");
    const j = await r.json();
    check(Array.isArray(j.files), "files 字段是数组");
  }

  step(5, "POST /api/generate(无 key 时期望 400)");
  {
    const r = await fetch(`${BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fal-ai/nano-banana-2",
        prompt: "test",
      }),
    });
    const j = await r.json().catch(() => ({}));
    check(r.status === 400, `HTTP 400(实际 ${r.status})`);
    check(/FAL_KEY/.test(j.error ?? ""), `错误信息含 FAL_KEY:${j.error}`);
  }

  step(6, "GET / (静态首页)");
  {
    const r = await fetch(`${BASE}/`);
    check(r.status === 200, "HTTP 200");
    const t = await r.text();
    check(t.includes("foxai_vigener"), "首页含 foxai_vigener");
    check(t.includes("/styles.css"), "引用了 styles.css");
    check(t.includes("/app.js"), "引用了 app.js");
    check(t.includes("customModal"), "页面含自定义模型弹层");
  }

  step(7, "自定义模型 CRUD");
  const testModel = {
    id: "test-org/test-model",
    label: "测试模型",
    type: "image",
    kind: "text-to-image",
  };
  {
    const r = await fetch(`${BASE}/api/custom-models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: testModel }),
    });
    check(r.status === 200, "POST 返回 200");
    const j = await r.json();
    check(j.ok === true, "ok=true");
    check(j.model?.id === testModel.id, "model.id 一致");
  }
  {
    const r = await fetch(`${BASE}/api/custom-models`);
    const j = await r.json();
    check(j.models?.some((m) => m.id === testModel.id), "列表包含新模型");
  }
  {
    // 已存在于 models 列表(因为合并)
    const r = await fetch(`${BASE}/api/models`);
    const j = await r.json();
    check(
      j.grouped?.image?.some((m) => m.id === testModel.id),
      "新模型进入 image 分组"
    );
  }
  {
    // 缺字段时报 400
    const r = await fetch(`${BASE}/api/custom-models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: { id: "x" } }),
    });
    check(r.status === 400, "缺 label 时返回 400");
  }
  {
    const r = await fetch(
      `${BASE}/api/custom-models/${encodeURIComponent(testModel.id)}`,
      { method: "DELETE" }
    );
    check(r.status === 200, "DELETE 返回 200");
    const j = await r.json();
    check(j.ok === true && j.removed === testModel.id, "removed 字段正确");
  }
  {
    // 删除后,models 不再包含
    const r = await fetch(`${BASE}/api/models`);
    const j = await r.json();
    check(
      !j.grouped?.image?.some((m) => m.id === testModel.id),
      "删除后从 image 分组移除"
    );
  }
} finally {
  child.kill("SIGTERM");
}

console.log(
  failures === 0
    ? "\n✓ 所有 API 测试通过"
    : `\n✗ ${failures} 个测试失败`
);
process.exit(failures === 0 ? 0 : 1);