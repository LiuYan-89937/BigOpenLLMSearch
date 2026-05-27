#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SearchTool, searchToolDefinition } from "./tools/search.js";
import { ExtractTool, extractToolDefinition } from "./tools/extract.js";
import { CrawlTool, crawlToolDefinition } from "./tools/crawl.js";
import { MapTool, mapToolDefinition } from "./tools/map.js";
import { ResearchTool, researchToolDefinition } from "./tools/research.js";

const server = new Server(
  {
    name: "bigopen-llm-search",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const tools = [
  searchToolDefinition,
  extractToolDefinition,
  crawlToolDefinition,
  mapToolDefinition,
  researchToolDefinition,
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: any;

    switch (name) {
      case "web_search":
        result = await SearchTool.execute(args as any);
        break;
      case "web_extract":
        result = await ExtractTool.execute(args as any);
        break;
      case "web_crawl":
        result = await CrawlTool.execute(args as any);
        break;
      case "web_map":
        result = await MapTool.execute(args as any);
        break;
      case "web_research":
        result = await ResearchTool.execute(args as any);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: errorMessage }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("BigOpenLLMSearch MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
