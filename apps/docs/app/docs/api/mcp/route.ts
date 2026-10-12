import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { registerSearchTool, registerSourceTools } from "fumadocs-core/mcp";
import { createFromSource } from "fumadocs-core/search/server";

import { appName } from "@/lib/shared";
import { docsLlms, source } from "@/lib/source";

// One search index per function instance, not one per request.
const search = createFromSource(source);

const handler = createMcpHandler(() => {
  const mcp = new McpServer({
    name: appName,
    version: "1.0.0",
  });

  registerSourceTools(mcp, source, docsLlms);
  registerSearchTool(mcp, search);

  return mcp;
});

export async function GET(request: Request) {
  return handler.fetch(request);
}

export async function POST(request: Request) {
  return handler.fetch(request);
}

export async function DELETE(request: Request) {
  return handler.fetch(request);
}
