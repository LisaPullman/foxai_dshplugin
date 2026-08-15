/**
 * foxai_vigener MCP server 集成测试客户端
 *
 * 流程:listTools → check_config → list_models → (无 key 时尝试 generate,期望清晰错误)
 *
 * 用法:node test/client.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "..", "index.js");

const step = (n, title) => console.log(`\n===== ${n}. ${title} =====`);
const firstText = (r) => r?.content?.[0]?.text ?? "(no text)";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env },
});
const client = new Client({ name: "foxai-vigener-test", version: "1.0.0" });
await client.connect(transport);

try {
  step(1, "listTools");
  const tools = await client.listTools();
  for (const t of tools.tools) console.log(`  - ${t.name}:${t.title}`);

  step(2, "check_config");
  const cfg = await client.callTool({ name: "check_config", arguments: {} });
  console.log(firstText(cfg));

  step(3, "list_models");
  const list = await client.callTool({ name: "list_models", arguments: {} });
  const parsed = JSON.parse(firstText(list));
  console.log(`  count=${parsed.count}  defaults=${JSON.stringify(parsed.defaults)}`);
  console.log("  分组:");
  for (const [type, items] of Object.entries(parsed.grouped)) {
    console.log(`    ${type}:${items.map((i) => i.id).join(", ")}`);
  }

  step(4, "generate(未配置 FAL_KEY 时,期望清晰错误)");
  const gen = await client.callTool({
    name: "generate",
    arguments: {
      model: "fal-ai/nano-banana-2",
      prompt: "A cute orange cat sitting on a wooden table, soft sunlight, photorealistic",
      aspectRatio: "16:9",
      numImages: 1,
    },
  });
  const text = firstText(gen);
  console.log(text);
  if (gen.isError || /未配置|缺少|失败/.test(text)) {
    console.log("  ✓ 期望的错误信息返回成功");
  } else {
    console.log("  · 未报错(说明 FAL_KEY 已配置,可能真实调用了 fal)");
  }
} finally {
  await client.close();
  // 让子进程退出
  setTimeout(() => process.exit(0), 200);
}