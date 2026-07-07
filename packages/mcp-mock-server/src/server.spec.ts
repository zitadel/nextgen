import request from "supertest";
import { describe, expect, it } from "vitest";

import type { McpMockServerConfig } from "./config.js";
import { createMcpMockApp } from "./server.js";

const config: McpMockServerConfig = {
  authorizationServer: "http://localhost:8080",
  host: "localhost",
  introspect: false,
  port: 9090,
  publicOrigin: "http://localhost:9090",
  resourceUri: "http://localhost:9090/mcp",
};

describe("mcp mock server", () => {
  const app = createMcpMockApp(config);

  it("serves RFC 9728 protected resource metadata", async () => {
    const response = await request(app).get("/.well-known/oauth-protected-resource/mcp");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      resource: "http://localhost:9090/mcp",
      authorization_servers: ["http://localhost:8080"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["openid", "profile", "email"],
    });
  });

  it("returns 401 with WWW-Authenticate for unauthenticated MCP requests", async () => {
    const response = await request(app).post("/mcp").send({ jsonrpc: "2.0", method: "initialize" });

    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toBe(
      'Bearer error="invalid_token", error_description="Authorization required", resource_metadata="http://localhost:9090/.well-known/oauth-protected-resource/mcp"',
    );
    expect(response.body.resource_metadata).toBe(
      "http://localhost:9090/.well-known/oauth-protected-resource/mcp",
    );
  });

  it("accepts any bearer token when introspection is disabled", async () => {
    const response = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer probe-token")
      .send({
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
          protocolVersion: "2025-06-18",
        },
      });

    expect(response.status).toBe(200);
    expect(response.headers["mcp-session-id"]).toBeTruthy();
    expect(response.body).toMatchObject({
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "zitadel-mcp-mock-server" },
      },
    });
  });

  it("serves CIMD metadata when public origin is https", async () => {
    const httpsConfig: McpMockServerConfig = {
      ...config,
      publicOrigin: "https://mcp.example.com",
      resourceUri: "https://mcp.example.com/mcp",
    };
    const httpsApp = createMcpMockApp(httpsConfig);
    const response = await request(httpsApp).get("/.well-known/oauth-client");

    expect(response.status).toBe(200);
    expect(response.body.redirect_uris).toEqual(["https://mcp.example.com/oauth/callback"]);
    expect(response.body.token_endpoint_auth_method).toBe("none");
  });

  it("returns 202 for initialized notification", async () => {
    const init = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer probe-token")
      .send({
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      });

    const sessionId = init.headers["mcp-session-id"];
    if (typeof sessionId !== "string") {
      throw new Error("initialize response did not include Mcp-Session-Id");
    }

    const response = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer probe-token")
      .set("Mcp-Session-Id", sessionId)
      .send({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

    expect(response.status).toBe(202);
  });
});
