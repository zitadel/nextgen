import { type APIRequestContext, expect, test } from "@playwright/test";

import { jsonRpcMessage } from "./support";

/**
 * What agents use besides the pages: the search the site's own dialog calls,
 * the MCP server, the plain-text answers, the Open Graph image. They live
 * under /docs beside the pages, so an agent asking for Markdown or plain text
 * must reach them unchanged: proxy.ts leaves them out of its matcher (#1685).
 */

test("search answers JSON hits under /docs", async ({ request }) => {
  const response = await request.get("/docs/api/search", { params: { query: "passkey" } });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  const hits = (await response.json()) as { url: string }[];
  expect(hits.length).toBeGreaterThan(0);
  expect(hits.filter((hit) => !hit.url.startsWith("/docs/"))).toEqual([]);
});

test("the routes that are not pages answer an agent that asks for text", async ({ request }) => {
  // isMarkdownPreferred counts text/plain as Markdown: without the matcher's
  // exclusions the proxy would rewrite these to Markdown twins that do not exist.
  const routes: [string, string][] = [
    ["/docs/api/search?query=passkey", "application/json"],
    ["/docs/llms.txt", "text/plain"],
    ["/docs/llms-full.txt", "text/plain"],
  ];
  for (const accept of ["text/plain", "text/markdown"]) {
    for (const [route, type] of routes) {
      const response = await request.get(route, { headers: { Accept: accept } });
      expect(response.status(), `${route} for ${accept}`).toBe(200);
      expect(response.headers()["content-type"], `${route} for ${accept}`).toContain(type);
    }
  }
});

test("a page advertises its Open Graph image, and the image renders", async ({ request }) => {
  const html = await (await request.get("/docs/cli")).text();
  const [, image = ""] = html.match(/<meta property="og:image" content="([^"]+)"/) ?? [];
  expect(image).not.toBe("");
  // Absolute, from the metadata base of the deployment; the path is the contract.
  const path = new URL(image).pathname;
  expect(path).toBe("/docs/og/cli/image.png");
  const response = await request.get(path);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
});

test.describe("the MCP server", () => {
  interface InitializeResult {
    serverInfo: { name: string };
    capabilities: { tools?: unknown };
  }
  interface ToolsListResult {
    tools: { name: string }[];
  }
  interface CallToolResult {
    content: { type: string; text?: string }[];
    isError?: boolean;
  }

  // Streamable HTTP: one POST per message, the answer as JSON or as SSE.
  function call(request: APIRequestContext, message: Record<string, unknown>) {
    return request.post("/docs/api/mcp", {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      data: { jsonrpc: "2.0", ...message },
    });
  }

  test("initializes and lists its tools, with no session to keep", async ({ request }) => {
    const initialized = await call(request, {
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "docs-e2e", version: "0" },
      },
    });
    expect(initialized.status()).toBe(200);
    const server = (await jsonRpcMessage(initialized)).result as InitializeResult;
    expect(server.serverInfo.name).toBe("Zitadel Preview Docs");
    expect(server.capabilities.tools).toBeDefined();

    // Stateless: no mcp-session-id to carry, every request stands on its own.
    const listed = await call(request, { id: 2, method: "tools/list" });
    expect(listed.status()).toBe(200);
    const tools = ((await jsonRpcMessage(listed)).result as ToolsListResult).tools;
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["search", "list_pages", "get_page"]),
    );
  });

  test("serves a page's Markdown through get_page", async ({ request }) => {
    const response = await call(request, {
      id: 3,
      method: "tools/call",
      params: { name: "get_page", arguments: { url: "/docs/cli" } },
    });
    expect(response.status()).toBe(200);
    const result = (await jsonRpcMessage(response)).result as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toMatch(/^# CLI \(\/docs\/cli\)/);
  });
});
