import { describe, expect, it } from "vitest";

import { discoverMcpResourceContext, parseResourceMetadataUrl } from "./mcp-discovery.js";

describe("mcp discovery", () => {
  it("parses resource_metadata from WWW-Authenticate", () => {
    expect(
      parseResourceMetadataUrl(
        'Bearer error="invalid_token", resource_metadata="http://mcp.local/.well-known/oauth-protected-resource/mcp"',
      ),
    ).toBe("http://mcp.local/.well-known/oauth-protected-resource/mcp");
  });

  it("discovers authorization server and resource URI from MCP metadata", async () => {
    const mcpBaseUrl = "http://mcp.local";
    const asBase = "http://auth.local";
    const resourceUri = `${mcpBaseUrl}/mcp`;

    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === `${mcpBaseUrl}/mcp`) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: {
            "WWW-Authenticate": `Bearer resource_metadata="${mcpBaseUrl}/.well-known/oauth-protected-resource/mcp"`,
          },
        });
      }

      if (url === `${mcpBaseUrl}/.well-known/oauth-protected-resource/mcp`) {
        return Response.json({
          resource: resourceUri,
          authorization_servers: [asBase],
        });
      }

      throw new Error(`unexpected fetch: ${url}`);
    };

    const context = await discoverMcpResourceContext({ fetchImpl, mcpBaseUrl });
    expect(context.authorizationServer).toBe(asBase);
    expect(context.resourceUri).toBe(resourceUri);
    expect(context.mcpEndpoint).toBe(`${mcpBaseUrl}/mcp`);
  });

  it("honors authorization server override", async () => {
    const mcpBaseUrl = "http://mcp.local";
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === `${mcpBaseUrl}/mcp`) {
        return new Response("", {
          status: 401,
          headers: {
            "WWW-Authenticate": `Bearer resource_metadata="${mcpBaseUrl}/.well-known/oauth-protected-resource"`,
          },
        });
      }

      if (url === `${mcpBaseUrl}/.well-known/oauth-protected-resource`) {
        return Response.json({
          resource: `${mcpBaseUrl}/mcp`,
          authorization_servers: ["http://discovered.local"],
        });
      }

      throw new Error(`unexpected fetch: ${url}`);
    };

    const context = await discoverMcpResourceContext({
      authorizationServerOverride: "http://override.local",
      fetchImpl,
      mcpBaseUrl,
    });
    expect(context.authorizationServer).toBe("http://override.local");
  });
});
