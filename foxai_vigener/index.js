#!/usr/bin/env node
/**
 * foxai_vigener MCP server (stdio)
 *
 * 把"任意 fal 端点 → 生成图片/视频/音频 → 下载到「完成档」"能力
 * 封装为 MCP 工具,供 Claude Code、DeepSeek Harness 等 MCP 客户端调用。
 *
 * 工具:
 *   - check_config   检查 FAL_KEY 是否就绪、注册表统计、文件夹路径
 *   - list_models    列出注册表(分类型分组 + 默认标记)
 *   - generate       { model, prompt, referenceImages?, aspectRatio?,
 *                     numImages?, duration?, extraInput? }
 *                     → 调 FAL → 下载产物到「完成档」,返回文件路径列表
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { isConfigReady, getReferencesDir, getOutputsDir } from "./lib/env.js";
import { listModels, defaultsByType, findModel } from "./lib/registry.js";
import { generate } from "./lib/generate.js";

const server = new McpServer({
  name: "foxai-vigener",
  version: "1.0.0",
});

// --- check_config ---
server.registerTool(
  "check_config",
  {
    title: "检查 foxai_vigener 配置",
    description:
      "检查 FAL_KEY、注册表统计、参考图/完成档路径。生成前可先调用。",
    inputSchema: {},
  },
  async () => {
    const models = listModels();
    const ready = isConfigReady();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              hasFalKey: ready,
              modelCount: models.length,
              defaults: defaultsByType(),
              referencesDir: getReferencesDir(),
              outputsDir: getOutputsDir(),
              hint: ready
                ? "已就绪"
                : "请在插件根目录创建 .env,写入 FAL_KEY=...(参考 .env.example)",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- list_models ---
server.registerTool(
  "list_models",
  {
    title: "列出 foxai_vigener 注册的模型",
    description:
      "返回预设 + 用户自定义合并后的模型清单,按 type 分组(isDefault 标记默认模型)。",
    inputSchema: {},
  },
  async () => {
    const models = listModels();
    const grouped = {};
    for (const m of models) {
      (grouped[m.type] ??= []).push(m);
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              count: models.length,
              grouped,
              defaults: defaultsByType(),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- generate ---
server.registerTool(
  "generate",
  {
    title: "用 fal 模型生成内容(图/视频/音频)",
    description:
      "调用指定模型生成内容,产物保存到「完成档」文件夹,命名规则:模型id-年月日-时分-序号.ext。",
    inputSchema: {
      model: z
        .string()
        .min(1)
        .describe(
          "模型 id(如 fal-ai/nano-banana-2、openai/gpt-image-2 等),可通过 list_models 查看"
        ),
      prompt: z.string().min(1).describe("提示词"),
      referenceImages: z
        .array(z.string())
        .optional()
        .describe(
          "参考图列表,每项可以是「参考图」文件夹内的文件名(如 hero.png)、绝对路径,或 https URL。仅当模型支持参考图时生效"
        ),
      aspectRatio: z
        .string()
        .optional()
        .describe("宽高比(如 16:9、9:16、1:1、4:3、3:4),默认 16:9"),
      numImages: z
        .number()
        .int()
        .min(1)
        .max(8)
        .optional()
        .describe("生成张数,默认 1"),
      duration: z
        .number()
        .optional()
        .describe("视频时长(秒),仅视频模型生效"),
      extraInput: z
        .record(z.any())
        .optional()
        .describe("透传给 fal 端点的高级参数(如 mask_url、voice 等)"),
    },
  },
  async ({
    model,
    prompt,
    referenceImages,
    aspectRatio,
    numImages,
    duration,
    extraInput,
  }) => {
    const found = findModel(model);
    if (!found) {
      return {
        content: [
          {
            type: "text",
            text: `未知模型:${model}。请先用 list_models 查看支持的模型。`,
          },
        ],
        isError: true,
      };
    }

    if (!isConfigReady()) {
      return {
        content: [
          {
            type: "text",
            text: "FAL_KEY 未配置。请在插件根目录 .env 中写入 FAL_KEY=...,然后重试。",
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await generate({
        model,
        prompt,
        referenceImages,
        aspectRatio,
        numImages,
        duration,
        extraInput,
      });
      const summary = {
        model: result.model,
        files: result.files.map((f) => ({
          path: f.path,
          fileName: f.fileName,
          mime: f.mime,
        })),
        logCount: result.logs.length,
      };
      return {
        content: [
          {
            type: "text",
            text: `已用模型 ${result.model} 生成 ${result.files.length} 个产物:\n\n${JSON.stringify(
              summary,
              null,
              2
            )}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: `生成失败:${err.message ?? String(err)}` },
        ],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[foxai_vigener] MCP server 已启动 (stdio) models=${listModels().length} falReady=${isConfigReady()}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`[foxai_vigener] 启动失败:${err.stack ?? err}\n`);
  process.exit(1);
});