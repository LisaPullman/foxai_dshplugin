#!/usr/bin/env python3
"""
Seedance 2.5 MCP Server for Claude

将 foxai_sd25_video 插件的核心功能暴露为 MCP (Model Context Protocol) 服务器，
让 Claude 用户可以直接调用工具来生成 Seedance 2.5 标准的视频提示词。

## 安装

1. 安装依赖：`pip install mcp httpx`
2. 在 Claude 配置文件中添加：

```json
{
  "mcpServers": {
    "seedance25": {
      "command": "python",
      "args": ["/path/to/foxai_sd2.5/claude/mcp-server.py"]
    }
  }
}
```

3. 重启 Claude 即可使用 `seedance25_*` 工具

## 工具列表

- `seedance25_specs`: 获取 Seedance 2.5 提示词契约规范
- `seedance25_generate`: 生成符合 Seedance 2.5 标准的提示词
- `seedance25_validate`: 校验提示词文本是否符合标准
"""
import json
import sys
import asyncio
from typing import Any

# 内置的 Seedance 2.5 契约库（简化版）
SD25_CONTRACTS = {
    "standard": {
        "name": "标准生成（4-30秒）",
        "template": """【素材说明】
{materials}

【一句话概述】
{overview}

【时间轴】
{timeline}

【全局补充】
{global}""",
    },
    "simple": {
        "name": "压缩版（4-15秒）",
        "template": "[主体和场景]。[可见动作与终点]。镜头：[单一运动]。光线：[光源]。声音：[环境/音效/对白/静音]。保持[关键不变量]；不要[关键排除项]。",
    },
    # 其他契约 ...
}


def generate_simple_prompt(data: dict) -> str:
    return (
        f"{data.get('subject', '[主体和场景]')}。"
        f"{data.get('action', '[可见动作与终点]')}。"
        f"镜头：{data.get('camera', '[单一运动]')}。"
        f"光线：{data.get('lighting', '[光源]')}。"
        f"声音：{data.get('audio', '[环境/音效/对白/静音]')}。"
        f"保持{data.get('locks', '[关键不变量]')}；"
        f"不要{data.get('exclusions', '[关键排除项]')}。"
    )


def generate_standard_prompt(data: dict) -> str:
    materials = data.get("materials", {})
    parts = []
    for img in materials.get("images", []):
        parts.append(f"@{img.get('id', '图片1')}用于{img.get('role', '未指定')}")
    materials_text = "；".join(parts) + "。" if parts else "（无外部素材）"

    timeline = data.get("timeline", [])
    timeline_lines = []
    for seg in timeline:
        timeline_lines.append(
            f"{seg.get('start', '0')}-{seg.get('end', 'N')}秒：{seg.get('description', '[待补充画面、动作、镜头、对白、音效]')}。"
        )
    timeline_text = "\n".join(timeline_lines) if timeline_lines else "0-N秒：[待补充画面、动作、镜头、对白、音效]。"

    global_obj = data.get("global", {})
    continuity = "、".join(global_obj.get("continuity", [])) or "[角色/服装/道具/场景/光影/音频连续性]"
    exclusions = "、".join(global_obj.get("exclusions", []))
    global_text = f"{continuity}。"
    if exclusions:
        global_text += f"不要{exclusions}。"

    return f"""【素材说明】
{materials_text}

【一句话概述】
{data.get('overview', '[主体]在[地点]完成[事件]，[题材/风格]，[核心镜头语言]。')}

【时间轴】
{timeline_text}

【全局补充】
{global_text}"""


# MCP 服务器实现
# 注意：实际使用时需要安装 mcp Python SDK: pip install mcp
try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("错误：需要安装 mcp 包：pip install mcp", file=sys.stderr)
    sys.exit(1)


app = Server("seedance25-mcp")


@app.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="seedance25_specs",
            description="获取 Seedance 2.5 视频生成的提示词契约规范",
            inputSchema={
                "type": "object",
                "properties": {
                    "contract_id": {
                        "type": "string",
                        "description": "要查询的契约 ID（standard/simple/complex_30s/ultra_long 等）",
                    },
                },
            },
        ),
        Tool(
            name="seedance25_generate",
            description="将结构化输入转换为符合 Seedance 2.5 标准格式的提示词文本",
            inputSchema={
                "type": "object",
                "properties": {
                    "contract_id": {"type": "string"},
                    "input": {"type": "object"},
                },
                "required": ["contract_id", "input"],
            },
        ),
        Tool(
            name="seedance25_validate",
            description="验证 Seedance 2.5 提示词文本是否符合标准",
            inputSchema={
                "type": "object",
                "properties": {
                    "prompt": {"type": "string"},
                    "contract_id": {"type": "string", "default": "standard"},
                },
                "required": ["prompt"],
            },
        ),
    ]


@app.call_tool()
async def call_tool(name: str, arguments: Any) -> list[TextContent]:
    try:
        if name == "seedance25_specs":
            contract_id = arguments.get("contract_id")
            if contract_id:
                contract = SD25_CONTRACTS.get(contract_id)
                if not contract:
                    return [TextContent(type="text", text=f"未找到契约: {contract_id}")]
                return [TextContent(type="text", text=json.dumps(contract, ensure_ascii=False, indent=2))]
            return [TextContent(type="text", text=json.dumps(SD25_CONTRACTS, ensure_ascii=False, indent=2))]

        elif name == "seedance25_generate":
            contract_id = arguments.get("contract_id")
            data = arguments.get("input", {})

            if contract_id == "simple":
                result = generate_simple_prompt(data)
            elif contract_id == "standard":
                result = generate_standard_prompt(data)
            else:
                return [TextContent(type="text", text=f"暂不支持契约: {contract_id}")]

            return [TextContent(type="text", text=result)]

        elif name == "seedance25_validate":
            prompt = arguments.get("prompt", "")
            issues = []
            warnings = []

            if not prompt or len(prompt.strip()) < 30:
                issues.append("提示词过短（<30 字符）")
            if len(prompt) > 3000:
                warnings.append("提示词过长（>3000 字符）")

            boosters = ["震撼", "极致", "完美", "史诗级", "惊艳", "8K", "masterpiece"]
            for b in boosters:
                if b in prompt:
                    warnings.append(f"建议移除泛化美化词: {b}")

            result = {
                "valid": len(issues) == 0,
                "issues": issues,
                "warnings": warnings,
                "summary": {"errors": len(issues), "warnings": len(warnings)},
            }
            return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=2))]

    except Exception as e:
        return [TextContent(type="text", text=f"错误: {str(e)}")]

    return [TextContent(type="text", text="未知工具")]


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
