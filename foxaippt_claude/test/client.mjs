/**
 * foxaippt MCP server 集成测试客户端
 * 通过 stdio 启动 index.js,依次:listTools → check_config → generate_ppt → export_ppt_html
 *
 * 用法:node test/client.mjs [文案文件路径]
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const serverPath = join(__dirname, "..", "index.js");

const SAMPLE_TEXT = `MCP(Model Context Protocol)是 Anthropic 于 2024 年 11 月开源的协议,为 AI 应用与外部数据源和工具之间建立了统一的连接标准。它被称为"AI 领域的 USB-C 接口":就像 USB-C 统一了各种设备的接口一样,MCP 统一了模型与工具的连接方式。

在 MCP 出现之前,每个 AI 应用要接入数据源(数据库、文件系统、API),都要写专门的集成代码,M×N 的组合让维护成本迅速膨胀。MCP 把这个问题变成 M+N:工具方实现一次 MCP server,应用方实现一次 MCP client,即可互相连通。

MCP 的核心架构包括三个角色:Host(宿主应用,如 Claude Desktop、Claude Code)、Client(宿主内的连接器,维护与 server 的一对一连接)、Server(提供能力的服务进程)。Server 可以向客户端暴露三类能力:Tools(可被模型调用的函数)、Resources(可读取的数据)、Prompts(预置的提示模板)。传输层支持 stdio(本地子进程)和 Streamable HTTP(远程服务)两种。

对开发者来说,写一个 MCP server 非常轻量:用官方 SDK 几十行代码就能把一个 HTTP API 封装成模型可调用的工具。Anthropic 同时开源了 SDK(TypeScript/Python 等)、规范和大量参考实现,社区里已有一千多个现成的 server。

MCP 的典型应用场景包括:让编程助手读写本地文件与数据库、让聊天客户端访问企业知识库、让自动化 Agent 操控浏览器与终端等。2025 年以来,OpenAI、Google 等厂商也宣布支持 MCP,它正在成为 Agent 生态的事实标准。`;

const text = process.argv[2]
  ? readFileSync(process.argv[2], "utf8")
  : SAMPLE_TEXT;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  // 默认只传安全白名单变量,这里显式继承完整环境(ANTHROPIC_* 等)
  env: { ...process.env },
});
const client = new Client({ name: "foxaippt-test-client", version: "1.0.0" });
await client.connect(transport);

const step = (name) => process.stdout.write(`\n===== ${name} =====\n`);
const firstText = (result) =>
  result.content?.find((c) => c.type === "text")?.text ?? "(无文本输出)";

// 1. listTools
step("1. listTools");
const tools = await client.listTools();
console.log(
  tools.tools.map((t) => `  - ${t.name}:${t.title}`).join("\n")
);

// 2. check_config
step("2. check_config");
const config = await client.callTool({ name: "check_config", arguments: {} });
console.log(firstText(config));

// 3. generate_ppt(真实调用 DeepSeek)
step("3. generate_ppt(调用当前 Claude Code 所用模型,可能需要 10~60 秒…)");
const t0 = Date.now();
const gen = await client.callTool({
  name: "generate_ppt",
  arguments: { text },
});
if (gen.isError) {
  console.error("generate_ppt 失败:", firstText(gen));
  process.exit(1);
}
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const genText = firstText(gen);
console.log(genText.slice(0, 300) + "\n  …(完整 JSON 已返回)");

// 从返回文本中截取 deck JSON
const jsonStart = genText.indexOf("{");
const deck = JSON.parse(genText.slice(jsonStart));

// 4. export_ppt_html
step("4. export_ppt_html");
const exp = await client.callTool({
  name: "export_ppt_html",
  arguments: {
    deck,
    outputPath: join(__dirname, "..", "output", `${deck.title.slice(0, 20)}.html`),
    theme: "ocean",
  },
});
if (exp.isError) {
  console.error("export_ppt_html 失败:", firstText(exp));
  process.exit(1);
}
console.log(firstText(exp));

await client.close();
process.stdout.write("\n✅ 全部测试通过\n");
process.exit(0);
