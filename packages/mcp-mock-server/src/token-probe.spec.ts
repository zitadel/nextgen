import { describe, expect, it } from "vitest";

import { audienceMatchesResource, decodeJwt } from "./jwt.js";
import { createPkcePair } from "./pkce.js";
import { buildAuthorizeUrl, exchangeAuthorizationCode } from "./token-probe.js";

describe("token probe helpers", () => {
  it("creates PKCE pairs", () => {
    const pair = createPkcePair();
    expect(pair.codeVerifier.length).toBeGreaterThan(20);
    expect(pair.codeChallenge.length).toBeGreaterThan(20);
  });

  it("builds authorize URLs with resource parameter", () => {
    const url = buildAuthorizeUrl({
      authorizationServer: "http://auth.local",
      clientId: "client-1",
      codeChallenge: "challenge",
      redirectUri: "http://127.0.0.1:8765/callback",
      resourceUri: "http://mcp.local/mcp",
      state: "state-1",
    });
    expect(url).toContain("client_id=client-1");
    expect(url).toContain("resource=http%3A%2F%2Fmcp.local%2Fmcp");
  });

  it("decodes jwt audience claims", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ aud: "http://mcp.local/mcp", sub: "user-1" }),
    ).toString("base64url");
    const token = `${header}.${payload}.`;
    const decoded = decodeJwt(token);
    expect(decoded?.payload.sub).toBe("user-1");
    expect(audienceMatchesResource(decoded?.payload ?? {}, "http://mcp.local/mcp")).toBe(true);
    expect(audienceMatchesResource(decoded?.payload ?? {}, "http://other.local/mcp")).toBe(false);
  });

  it("sends resource to the token endpoint", async () => {
    let tokenBody = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      tokenBody = String(init?.body ?? "");
      return Response.json({ access_token: "jwt.token.here", token_type: "Bearer" });
    };

    await exchangeAuthorizationCode({
      authorizationServer: "http://auth.local",
      clientId: "client-1",
      code: "auth-code",
      codeVerifier: "verifier",
      fetchImpl,
      redirectUri: "http://127.0.0.1:8765/callback",
      resourceUri: "http://mcp.local/mcp",
    });

    expect(tokenBody).toContain("resource=http%3A%2F%2Fmcp.local%2Fmcp");
    expect(tokenBody).toContain("code_verifier=verifier");
  });
});
