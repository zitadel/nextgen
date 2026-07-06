import { describe, expect, it } from "vitest";

import { formatOAuthProbeReport, runOAuthProbe } from "./oauth-probe.js";

describe("oauth probe", () => {
  it("reports MCP and authorization-server gaps", async () => {
    const mcpBaseUrl = "http://mcp.local";
    const asBase = "http://auth.local";
    const resourceUri = `${mcpBaseUrl}/mcp`;

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? "GET").toUpperCase();

      if (url === `${mcpBaseUrl}/mcp` && method === "POST") {
        return new Response(
          JSON.stringify({
            error: "unauthorized",
            resource_metadata: `${mcpBaseUrl}/.well-known/oauth-protected-resource`,
          }),
          {
            status: 401,
            headers: {
              "WWW-Authenticate": `Bearer realm="mcp", resource_metadata="${mcpBaseUrl}/.well-known/oauth-protected-resource"`,
            },
          },
        );
      }

      if (url === `${mcpBaseUrl}/.well-known/oauth-protected-resource`) {
        return Response.json({
          resource: resourceUri,
          authorization_servers: [asBase],
          bearer_methods_supported: ["header"],
          scopes_supported: ["openid"],
        });
      }

      if (url === `${asBase}/.well-known/oauth-authorization-server`) {
        return new Response(JSON.stringify({ code: 5, message: "Not Found" }), { status: 404 });
      }

      if (url === `${asBase}/.well-known/openid-configuration`) {
        return Response.json({
          issuer: asBase,
          authorization_endpoint: `${asBase}/oauth/v2/authorize`,
          token_endpoint: `${asBase}/oauth/v2/token`,
          registration_endpoint: `${asBase}/oauth/v2/register`,
          code_challenge_methods_supported: ["S256"],
          response_types_supported: ["code", "id_token token"],
          grant_types_supported: ["authorization_code", "refresh_token"],
        });
      }

      if (url === `${asBase}/oauth/v2/register` && method === "POST") {
        return new Response("404 page not found", { status: 404 });
      }

      if (url.startsWith(`${asBase}/oauth/v2/authorize?`)) {
        return new Response("", {
          status: 302,
          headers: { Location: `${asBase}/ui/login?authRequest=test` },
        });
      }

      return new Response("not found", { status: 404 });
    };

    const report = await runOAuthProbe({
      authorizationServerOverride: asBase,
      fetchImpl,
      mcpBaseUrl,
    });

    expect(report.summary.pass).toBeGreaterThan(0);
    expect(report.summary.fail).toBeGreaterThan(0);
    expect(report.steps.find((step) => step.name.includes("RFC 8414"))?.status).toBe("fail");
    expect(report.steps.find((step) => step.name.includes("Dynamic client registration"))?.status).toBe(
      "fail",
    );
    expect(formatOAuthProbeReport(report)).toContain("MCP OAuth probe report");
  });

  it("uses a freshly registered client for authorize when DCR succeeds", async () => {
    const mcpBaseUrl = "http://mcp.local";
    const asBase = "http://auth.local";
    const resourceUri = `${mcpBaseUrl}/mcp`;
    const dcrClientId = "dcr-client-123";
    const mcpRedirectUri = "http://127.0.0.1/callback";
    let authorizeUrl = "";

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? "GET").toUpperCase();

      if (url === `${mcpBaseUrl}/mcp` && method === "POST") {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: {
            "WWW-Authenticate": `Bearer realm="mcp", resource_metadata="${mcpBaseUrl}/.well-known/oauth-protected-resource"`,
          },
        });
      }

      if (url === `${mcpBaseUrl}/.well-known/oauth-protected-resource`) {
        return Response.json({
          resource: resourceUri,
          authorization_servers: [asBase],
        });
      }

      if (url === `${asBase}/.well-known/oauth-authorization-server`) {
        return Response.json({
          issuer: asBase,
          authorization_endpoint: `${asBase}/oauth/v2/authorize`,
          registration_endpoint: `${asBase}/oauth/v2/register`,
          code_challenge_methods_supported: ["S256"],
          response_types_supported: ["code"],
        });
      }

      if (url === `${asBase}/oauth/v2/register` && method === "POST") {
        return Response.json(
          {
            client_id: dcrClientId,
            redirect_uris: [mcpRedirectUri],
            grant_types: ["authorization_code"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
            application_type: "native",
          },
          { status: 201 },
        );
      }

      if (url.startsWith(`${asBase}/oauth/v2/authorize?`)) {
        authorizeUrl = url;
        return new Response("", {
          status: 302,
          headers: { Location: `${asBase}/ui/login?authRequest=test` },
        });
      }

      return new Response("not found", { status: 404 });
    };

    const report = await runOAuthProbe({
      authorizationServerOverride: asBase,
      fetchImpl,
      mcpBaseUrl,
    });

    expect(report.registeredClientId).toBe(dcrClientId);
    expect(report.authorizeClientId).toBe(dcrClientId);
    expect(report.authorizeRedirectUri).toBe(mcpRedirectUri);
    expect(authorizeUrl).toContain(`client_id=${dcrClientId}`);
    expect(authorizeUrl).toContain(`redirect_uri=${encodeURIComponent(mcpRedirectUri)}`);
    expect(authorizeUrl).toContain(`resource=${encodeURIComponent(resourceUri)}`);
    expect(
      report.steps.find((step) => step.name.includes("Authorization request"))?.status,
    ).toBe("pass");
  });
});
