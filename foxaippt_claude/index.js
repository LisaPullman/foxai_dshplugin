#!/usr/bin/env node
/**
 * foxaippt MCP server(stdio)
 *
 * 把 foxaippt 的"长文案 → 多页 PPT → 独立 HTML"能力封装为 MCP 工具,
 * 供 Claude Code 等 MCP 客户端调用。
 *
 * 工具:
 * 模型与 API 直接复用 Claude Code 本机配置(ANTHROPIC_BASE_URL /
 * ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL),即当前 Claude Code 正在调用的模型。
 *
 * 工具:
 *   - check_config     检查模型 / base_url / API Key 是否就绪
 *   - generate_ppt     长文案 → PPT 结构 JSON(deck)
 *   - export_ppt_html  deck(或直接给文案)→ 写出独立 HTML 演示文件
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  resolveBaseUrl,
  resolveModel,
  resolveApiKey,
  generateDeck,
} from "./lib/llm.js";
import { THEMES, exportDeckHtml } from "./lib/export-html.js";

const server = new McpServer({
  name: "foxaippt",
  version: "1.0.0",
});

// ---------- check_config ----------
server.registerTool(
  "check_config",
  {
    title: "检查 foxaippt 配置",
    description:
      "检查 LLM 配置是否就绪:当前使用的模型(与 Claude Code 一致)、base_url、API Key 是否存在。调用 generate_ppt 前可先检查。",
    inputSchema: {},
  },
  async () => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              model: resolveModel(),
              baseUrl: resolveBaseUrl(),
              hasApiKey: Boolean(resolveApiKey()),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ---------- generate_ppt ----------
server.registerTool(
  "generate_ppt",
  {
    title: "长文案生成 PPT 结构",
    description:
      "把长文案交给当前 Claude Code 所用模型拆解为多页 PPT 结构(JSON):封面 title/subtitle + slides(每页 title/bullets/notes)。返回的 deck 可直接传给 export_ppt_html 导出 HTML。",
    inputSchema: {
      text: z.string().min(1).describe("要拆解为 PPT 的长文案(任意语言,建议 500 字以上)"),
    },
  },
  async ({ text }) => {
    const { model, deck } = await generateDeck(text);
    return {
      content: [
        {
          type: "text",
          text: `已用模型 ${model} 生成 PPT 结构:《${deck.title}》共 ${deck.slides.length} 页(不含封面/结束页)\n\n${JSON.stringify(deck, null, 2)}`,
        },
      ],
    };
  }
);

// ---------- export_ppt_html ----------
server.registerTool(
  "export_ppt_html",
  {
    title: "导出独立 HTML 演示文件",
    description:
      "把 PPT 结构(deck)渲染为独立 HTML 文件:内联全部 CSS/JS/内容,双击即可离线打开、键盘翻页(←/→/Space/F 全屏)、循环切换 5 套主题。也可以只给 text,会自动先调模型生成再导出。",
    inputSchema: {
      deck: z
        .object({
          title: z.string(),
          subtitle: z.string().optional(),
          slides: z
            .array(
              z.object({
                title: z.string(),
                subtitle: z.string().optional(),
                bullets: z.array(z.string()).optional(),
                notes: z.string().optional(),
              })
            )
            .min(1),
        })
        .describe("generate_ppt 返回的 PPT 结构;与 text 二选一")
        .optional(),
      text: z
        .string()
        .min(1)
        .describe("长文案(提供时自动先生成 PPT);与 deck 二选一")
        .optional(),
      outputPath: z
        .string()
        .min(1)
        .describe("输出 HTML 文件路径(相对当前目录或绝对路径)"),
      theme: z
        .enum(THEMES)
        .describe("配色主题,默认 midnight(午夜蓝)。可选:ocean/sunset/forest/paper")
        .optional(),
    },
  },
  async ({ deck, text, outputPath, theme }) => {
    if (!deck && !text) {
      return {
        isError: true,
        content: [{ type: "text", text: "参数错误:deck 与 text 至少提供一个" }],
      };
    }
    const finalDeck = deck || (await generateDeck(text));
    const result = exportDeckHtml(finalDeck, outputPath, theme || "midnight");
    return {
      content: [
        {
          type: "text",
          text: `已导出独立 HTML:${result.absolutePath}\n主题:${result.themeName} · 共 ${result.slideCount} 页(含封面/结束页)· 双击即可离线打开,←/→ 翻页,F 全屏,🎨 换主题`,
        },
      ],
    };
  }
);

// ---------- 启动(stdio) ----------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[foxaippt] MCP server 已启动(stdio) model=${resolveModel()}\n`);
}

main().catch((err) => {
  process.stderr.write(`[foxaippt] 启动失败:${err?.message || err}\n`);
  process.exit(1);
});
