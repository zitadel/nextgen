import { type APIRequestContext, expect, test } from "@playwright/test";

import { jsonRpcMessage } from "./support";

/**
 * What agents use besides the pages: the search the site's own dialog calls,
 * the MCP server, the plain-text answers, the OpenAPI document, the Open Graph
 * image. They live under /docs beside the pages, so an agent asking for
 * Markdown or plain text must reach them unchanged: proxy.ts leaves them out
 * of its matcher (#1685).
 */

test("search answers JSON hits under /docs", async ({ request }) => {
  const response = await request.get("/docs/api/search", { params: { query: "passkey" } });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  const hits = (await response.json()) as { url: string }[];
  expect(hits.length).toBeGreaterThan(0);
  expect(hits.filter((hit) => !hit.url.startsWith("/docs/"))).toEqual([]);
});

/**
 * The feedback card's route turns a valid rating into a Web Analytics event,
 * so the suite, which also runs against deployments, sends only ones it must
 * refuse. The card's side is in site.browser.spec.ts.
 */
test("the feedback route refuses a rating it would not record", async ({ request }) => {
  const valid = { opinion: "good", page: "/docs/get-started/quickstart", message: "" };
  const invalid: [string, unknown][] = [
    ["an opinion off the scale", { ...valid, opinion: "meh" }],
    ["a page outside /docs", { ...valid, page: "/console" }],
    ["a message Web Analytics would drop", { ...valid, message: "x".repeat(256) }],
    ["no message", { opinion: valid.opinion, page: valid.page }],
    ["a body that is not JSON", "good"],
  ];
  for (const [what, body] of invalid) {
    const response = await request.post("/docs/api/feedback", {
      headers: { "content-type": "application/json" },
      data: typeof body === "string" ? body : JSON.stringify(body),
    });
    expect(response.status(), what).toBe(400);
  }
});

test("the routes that are not pages answer an agent that asks for text", async ({ request }) => {
  // isMarkdownPreferred counts text/plain as Markdown: without the matcher's
  // exclusions the proxy would rewrite these to Markdown twins that do not exist.
  const routes: [string, string][] = [
    ["/docs/api/search?query=passkey", "application/json"],
    ["/docs/llms.txt", "text/plain"],
    ["/docs/llms-full.txt", "text/plain"],
    ["/docs/openapi.json", "application/json"],
    ["/docs/mock-service-worker.js", "text/javascript"],
  ];
  for (const accept of ["text/plain", "text/markdown"]) {
    for (const [route, type] of routes) {
      const response = await request.get(route, { headers: { Accept: accept } });
      expect(response.status(), `${route} for ${accept}`).toBe(200);
      expect(response.headers()["content-type"], `${route} for ${accept}`).toContain(type);
    }
  }
});

test("the whole OpenAPI document is served as JSON, and llms.txt links it", async ({ request }) => {
  const response = await request.get("/docs/openapi.json");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  const document = (await response.json()) as {
    openapi: string;
    info: { title: string };
    paths: Record<string, unknown>;
  };
  expect(document.openapi).toMatch(/^3\.1\./);
  expect(document.info.title).not.toBe("");
  expect(Object.keys(document.paths).length).toBeGreaterThan(0);
  // Bundled (scripts/bundle-openapi.mjs): every reference points into the
  // document itself, at something there.
  const refs = [...JSON.stringify(document).matchAll(/"\$ref":"([^"]*)"/g)].map(
    ([, ref = ""]) => ref,
  );
  expect(refs.length).toBeGreaterThan(0);
  const target = (ref: string) =>
    ref
      .slice(2)
      .split("/")
      .map((key) => decodeURIComponent(key).replace(/~1/g, "/").replace(/~0/g, "~"))
      .reduce<unknown>(
        (node, key) => (node as Record<string, unknown> | undefined)?.[key],
        document,
      );
  expect(
    [...new Set(refs)].filter((ref) => !ref.startsWith("#/") || target(ref) === undefined),
    "references that do not resolve inside the document",
  ).toEqual([]);

  const index = await (await request.get("/docs/llms.txt")).text();
  expect(index).toContain("](/docs/openapi.json)");
});

test("a page advertises its Open Graph image, and the image renders", async ({ request }) => {
  const html = await (await request.get("/docs/get-started/quickstart")).text();
  const [, image = ""] = html.match(/<meta property="og:image" content="([^"]+)"/) ?? [];
  expect(image).not.toBe("");
  // Absolute, from the metadata base of the deployment; the path is the contract.
  const path = new URL(image).pathname;
  expect(path).toBe("/docs/og/get-started/quickstart/image.png");
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

  test("lists each page by the URL get_page takes", async ({ request }) => {
    // Not the Markdown URLs /docs/llms.txt lists (lib/source.ts).
    const response = await call(request, {
      id: 4,
      method: "tools/call",
      params: { name: "list_pages", arguments: {} },
    });
    expect(response.status()).toBe(200);
    const result = (await jsonRpcMessage(response)).result as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toContain("(/docs/get-started/quickstart)");
  });

  test("serves a page's Markdown through get_page", async ({ request }) => {
    const response = await call(request, {
      id: 3,
      method: "tools/call",
      params: { name: "get_page", arguments: { url: "/docs/get-started/quickstart" } },
    });
    expect(response.status()).toBe(200);
    const result = (await jsonRpcMessage(response)).result as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toMatch(/^# Quickstart \(\/docs\/get-started\/quickstart\)/);
  });
});
