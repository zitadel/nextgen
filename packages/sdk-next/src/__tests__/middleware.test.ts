import { NextRequest } from "next/server";
import { generateKeyPairSync, createSign } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { nextgenMiddleware } from "../middleware";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyJwk = publicKey.export({
  type: "spki",
  format: "jwk",
}) as Record<string, unknown>;

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(
  payload: Record<string, unknown>,
  kid: string,
  typ = "JWT",
  alg = "RS256",
): string {
  const header = base64url(Buffer.from(JSON.stringify({ alg, typ, kid })));
  const body = base64url(Buffer.from(JSON.stringify(payload)));
  const signing = `${header}.${body}`;
  const sign = createSign("SHA256");
  sign.update(signing);
  const sig = sign.sign(privateKeyPem);
  return `${signing}.${base64url(sig)}`;
}

function makeRequest(url: string, cookie?: string, authorization?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (cookie) headers["cookie"] = cookie;
  if (authorization) headers["authorization"] = authorization;
  return new NextRequest(url, { headers });
}

/**
 * Monotonically increasing key-ID counter. Each test that exercises JWKS
 * lookup receives a unique `kid`, which maps to a unique cache entry in the
 * module-level JWKS cache inside `lib/jwt.ts`. This keeps tests hermetically
 * isolated without requiring a cache-reset export.
 */
let kidCounter = 0;
function nextKid(): string {
  return `next-test-key-${++kidCounter}`;
}

/**
 * Builds a minimal JWKS response containing only the shared public key,
 * tagged with the given `kid`. Using a per-test `kid` prevents the JWKS
 * cache from serving a stale entry imported by a previous test run.
 */
function mockJwks(kid: string): ReturnType<typeof vi.fn> {
  const jwks = { keys: [{ ...publicKeyJwk, kid, alg: "RS256", use: "sig" }] };
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(jwks), { status: 200 }));
}

describe("nextgenMiddleware", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("public route with no token passes through with empty x-nextgen-auth-token", async () => {
    const req = makeRequest("http://localhost:3000/");
    const res = await nextgenMiddleware(req, {
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });

    expect(res.status).not.toBe(302);
    const token =
      res.headers.get("x-nextgen-auth-token") ??
      res.headers.get("x-middleware-request-x-nextgen-auth-token");
    expect(token).toBe("");
  });

  it("protected route with no token redirects to /login?next=/admin", async () => {
    const req = makeRequest("http://localhost:3000/admin");
    const res = await nextgenMiddleware(req, {
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("next=%2Fadmin");
  });

  it("redirect preserves existing query params in loginPath", async () => {
    const req = makeRequest("http://localhost:3000/admin");
    const res = await nextgenMiddleware(req, {
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login?tab=sso",
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    const parsed = new URL(location, "http://localhost:3000");
    expect(parsed.searchParams.get("tab")).toBe("sso");
    expect(parsed.searchParams.get("next")).toBe("/admin");
  });

  it("protected route with valid cookie passes through with token tunnelled", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt(
      {
        sub: "user-123",
        email: "user@example.com",
        iss: "http://localhost:4000",
        exp,
      },
      kid,
    );

    vi.stubGlobal("fetch", mockJwks(kid));

    const req = makeRequest("http://localhost:3000/admin", `__nextgen_session=${token}`);
    const res = await nextgenMiddleware(req, {
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });

    expect(res.status).not.toBe(302);
    const tunnelledToken = res.headers.get("x-middleware-request-x-nextgen-auth-token");
    expect(tunnelledToken).toBe(token);
  });

  it("protected route with valid Bearer token passes through", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt(
      {
        sub: "user-123",
        email: "user@example.com",
        iss: "http://localhost:4000",
        exp,
      },
      kid,
    );

    vi.stubGlobal("fetch", mockJwks(kid));

    const req = makeRequest("http://localhost:3000/admin", undefined, `Bearer ${token}`);
    const res = await nextgenMiddleware(req, {
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });

    expect(res.status).not.toBe(302);
    const tunnelledToken = res.headers.get("x-middleware-request-x-nextgen-auth-token");
    expect(tunnelledToken).toBe(token);
  });

  it("Bearer token takes precedence over session cookie when both are present (R-1)", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const bearerToken = makeJwt(
      {
        sub: "bearer-user",
        email: "bearer@example.com",
        iss: "http://localhost:4000",
        exp,
      },
      kid,
    );
    const cookieToken = makeJwt(
      {
        sub: "cookie-user",
        email: "cookie@example.com",
        iss: "http://localhost:4000",
        exp,
      },
      kid,
    );

    vi.stubGlobal("fetch", mockJwks(kid));

    const req = new NextRequest("http://localhost:3000/admin", {
      headers: {
        authorization: `Bearer ${bearerToken}`,
        cookie: `__nextgen_session=${cookieToken}`,
      },
    });
    const res = await nextgenMiddleware(req, {
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });

    const tunnelled =
      res.headers.get("x-nextgen-auth-token") ??
      res.headers.get("x-middleware-request-x-nextgen-auth-token");
    expect(tunnelled).toBe(bearerToken);
    expect(tunnelled).not.toBe(cookieToken);
  });

  it("redirect response includes Set-Cookie to clear stale session cookie", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const validToken = makeJwt({ sub: "user-123", email: "user@example.com", exp }, kid);
    const parts = validToken.split(".");
    const tamperedToken = `${parts[0]}.${parts[1]}.invalidsignatureXXX`;

    vi.stubGlobal("fetch", mockJwks(kid));

    const req = makeRequest("http://localhost:3000/admin", `__nextgen_session=${tamperedToken}`);
    const res = await nextgenMiddleware(req, {
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });

    expect(res.status).toBe(302);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/__nextgen_session=/);
    expect(setCookie).toMatch(/Max-Age=0|expires=.*1970/i);
  });

  it("token with disallowed typ is rejected on protected route", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt(
      { sub: "user-123", email: "user@example.com", exp },
      kid,
      "refresh_token",
    );

    vi.stubGlobal("fetch", mockJwks(kid));

    const req = makeRequest("http://localhost:3000/admin", `__nextgen_session=${token}`);
    const res = await nextgenMiddleware(req, {
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      allowedTokenTypes: ["JWT", "at+JWT"],
    });

    expect(res.status).toBe(302);
  });

  it("token with disallowed algorithm is rejected on protected route", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt({ sub: "user-123", email: "user@example.com", exp }, kid);

    vi.stubGlobal("fetch", mockJwks(kid));

    const req = makeRequest("http://localhost:3000/admin", `__nextgen_session=${token}`);
    const res = await nextgenMiddleware(req, {
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      allowedAlgorithms: ["ES256"],
    });

    expect(res.status).toBe(302);
  });

  it("strips x-nextgen-auth-token from proxied requests", async () => {
    let capturedHeaders: Headers | undefined;
    const upstreamFetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Headers;
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest("http://localhost:3000/__nextgen/v1/flow", {
      method: "GET",
      headers: {
        "x-nextgen-auth-token": "secret-session-token",
        "content-type": "application/json",
      },
    });
    await nextgenMiddleware(req, { url: "http://localhost:4000" });

    expect(capturedHeaders).toBeDefined();
    expect((capturedHeaders as Headers).has("x-nextgen-auth-token")).toBe(false);
    expect((capturedHeaders as Headers).get("content-type")).toBe("application/json");
  });

  it("accepts RS256 tokens by default (allowedAlgorithms defaults to RS256/ES256)", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt(
      {
        sub: "user-123",
        email: "user@example.com",
        iss: "http://localhost:4000",
        exp,
      },
      kid,
    );

    vi.stubGlobal("fetch", mockJwks(kid));

    const req = makeRequest("http://localhost:3000/admin", `__nextgen_session=${token}`);
    // No allowedAlgorithms specified — defaults to ['RS256', 'ES256']
    const res = await nextgenMiddleware(req, {
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });

    expect(res.status).not.toBe(302);
  });

  it("protected route with invalid token clears cookie and redirects", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const validToken = makeJwt({ sub: "user-123", email: "user@example.com", exp }, kid);
    const parts = validToken.split(".");
    const tamperedToken = `${parts[0]}.${parts[1]}.invalidsignatureXXX`;

    vi.stubGlobal("fetch", mockJwks(kid));

    const req = makeRequest("http://localhost:3000/admin", `__nextgen_session=${tamperedToken}`);
    const res = await nextgenMiddleware(req, {
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
  });

  it('token with alg "none" is rejected on a protected route', async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt(
      {
        sub: "user-123",
        email: "user@example.com",
        iss: "http://localhost:4000",
        exp,
      },
      kid,
      "JWT",
      "none",
    );

    vi.stubGlobal("fetch", vi.fn());

    const req = makeRequest("http://localhost:3000/admin", `__nextgen_session=${token}`);
    const res = await nextgenMiddleware(req, {
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });

    expect(res.status).toBe(302);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("token without sub claim is rejected on a protected route", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt(
      {
        email: "user@example.com",
        iss: "http://localhost:4000",
        exp,
      },
      kid,
    );

    vi.stubGlobal("fetch", mockJwks(kid));

    const req = makeRequest("http://localhost:3000/admin", `__nextgen_session=${token}`);
    const res = await nextgenMiddleware(req, {
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
  });

  it("token without sub on public route passes through as unauthenticated", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt(
      {
        email: "user@example.com",
        iss: "http://localhost:4000",
        exp,
      },
      kid,
    );

    vi.stubGlobal("fetch", mockJwks(kid));

    const req = makeRequest("http://localhost:3000/", `__nextgen_session=${token}`);
    const res = await nextgenMiddleware(req, {
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });

    expect(res.status).not.toBe(302);
    const authToken =
      res.headers.get("x-nextgen-auth-token") ??
      res.headers.get("x-middleware-request-x-nextgen-auth-token");
    expect(authToken).toBe("");
  });

  describe("proxy: cookie forwarding", () => {
    it("forwards upstream Set-Cookie headers as-is", async () => {
      const upstreamHeaders = new Headers();
      upstreamHeaders.append("set-cookie", "__nextgen_session=abc; HttpOnly; SameSite=Lax");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("{}", { status: 200, headers: upstreamHeaders })),
      );

      const req = new NextRequest("http://localhost:3000/__nextgen/v1/flow");
      const res = await nextgenMiddleware(req, {
        url: "http://localhost:4000",
      });

      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie).toBe("__nextgen_session=abc; HttpOnly; SameSite=Lax");
    });
  });

  describe("proxy: credential planes", () => {
    it.each([
      ["GET", "/__nextgen/sessions/me"],
      ["DELETE", "/__nextgen/sessions/me"],
      ["POST", "/__nextgen/flow"],
      ["GET", "/__nextgen/projects"],
      ["GET", "/__nextgen/sessions/exchange"],
      ["POST", "/__nextgen/sessions/exchange/extra"],
    ])("does not attach the project secret to %s %s", async (method, pathname) => {
      vi.stubEnv("ZITADEL_PROJECT_SECRET", "project-secret");
      let capturedHeaders: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          capturedHeaders = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );

      await nextgenMiddleware(new NextRequest(`http://localhost:3000${pathname}`, { method }), {
        url: "http://localhost:4000",
      });

      expect((capturedHeaders as Headers).has("authorization")).toBe(false);
    });

    it("attaches the project secret only to POST /sessions/exchange, ignoring the query", async () => {
      vi.stubEnv("ZITADEL_PROJECT_SECRET", "project-secret");
      let capturedHeaders: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          capturedHeaders = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );

      await nextgenMiddleware(
        new NextRequest("http://localhost:3000/__nextgen/sessions/exchange?source=browser", {
          method: "POST",
        }),
        { url: "http://localhost:4000" },
      );

      expect((capturedHeaders as Headers).get("authorization")).toBe("Bearer project-secret");
    });

    it("preserves an explicit caller credential on the exchange", async () => {
      vi.stubEnv("ZITADEL_PROJECT_SECRET", "project-secret");
      let capturedHeaders: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          capturedHeaders = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );

      await nextgenMiddleware(
        new NextRequest("http://localhost:3000/__nextgen/sessions/exchange", {
          method: "POST",
          headers: { authorization: "Bearer caller-key" },
        }),
        { url: "http://localhost:4000" },
      );

      expect((capturedHeaders as Headers).get("authorization")).toBe("Bearer caller-key");
    });

    it("preserves the upstream session cache policy", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response("{}", {
            status: 200,
            headers: { "cache-control": "private, no-store" },
          }),
        ),
      );

      const response = await nextgenMiddleware(
        new NextRequest("http://localhost:3000/__nextgen/sessions/me"),
        { url: "http://localhost:4000" },
      );

      expect(response.headers.get("cache-control")).toBe("private, no-store");
    });
  });

  describe("proxy: Location header stripping (S-1)", () => {
    it("strips location header from upstream response to prevent internal URL leakage", async () => {
      const upstreamHeaders = new Headers();
      upstreamHeaders.set("content-type", "application/json");
      upstreamHeaders.set("location", "http://internal-auth.corp:4000/callback");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("{}", { status: 302, headers: upstreamHeaders })),
      );

      const req = new NextRequest("http://localhost:3000/__nextgen/v1/flow");
      const res = await nextgenMiddleware(req, {
        url: "http://localhost:4000",
      });

      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("content-type")).toBe("application/json");
    });
  });

  describe("tunnel: client header injection prevention (P-1)", () => {
    it("does not preserve client-injected x-middleware-override-headers", async () => {
      const req = new NextRequest("http://localhost:3000/", {
        headers: {
          "x-middleware-override-headers": "x-evil-header,x-another-evil",
        },
      });
      const res = await nextgenMiddleware(req, {
        url: "http://localhost:4000",
        protectedRoutes: ["/admin"],
      });

      // The override list must contain only what the middleware injected (the
      // auth-token header), never anything the client sent.
      const overrideHeaders = res.headers.get("x-middleware-override-headers") ?? "";
      expect(overrideHeaders).toContain("x-nextgen-auth-token");
      expect(overrideHeaders).not.toContain("x-evil-header");
      expect(overrideHeaders).not.toContain("x-another-evil");
    });
  });

  describe("loginPath validation (P-3)", () => {
    it("throws when loginPath is an absolute URL", async () => {
      await expect(
        nextgenMiddleware(makeRequest("http://localhost:3000/admin"), {
          url: "http://localhost:4000",
          protectedRoutes: ["/admin"],
          loginPath: "https://evil.example.com/phish",
        }),
      ).rejects.toThrow(/loginPath must be a relative path/i);
    });

    it("throws when loginPath is a protocol-relative URL", async () => {
      await expect(
        nextgenMiddleware(makeRequest("http://localhost:3000/admin"), {
          url: "http://localhost:4000",
          protectedRoutes: ["/admin"],
          loginPath: "//evil.example.com/phish",
        }),
      ).rejects.toThrow(/loginPath must be a relative path/i);
    });

    it("accepts a relative loginPath and redirects correctly", async () => {
      const req = makeRequest("http://localhost:3000/admin");
      const res = await nextgenMiddleware(req, {
        url: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        loginPath: "/custom-login",
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("/custom-login");
    });
  });

  describe("proxy: X-Forwarded-For append (P-4)", () => {
    it("appends x-real-ip to an existing X-Forwarded-For chain", async () => {
      let capturedHeaders: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          capturedHeaders = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );

      const req = new NextRequest("http://localhost:3000/__nextgen/v1/flow", {
        method: "GET",
        headers: {
          "x-forwarded-for": "10.0.0.1",
          "x-real-ip": "192.168.1.1",
        },
      });
      await nextgenMiddleware(req, { url: "http://localhost:4000" });

      expect(capturedHeaders).toBeDefined();
      const xff = (capturedHeaders as Headers).get("x-forwarded-for") ?? "";
      // Both the original chain and the new hop must appear
      expect(xff).toContain("10.0.0.1");
      expect(xff).toContain("192.168.1.1");
    });

    it("sets X-Forwarded-For from x-real-ip when no chain exists", async () => {
      let capturedHeaders: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          capturedHeaders = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );

      const req = new NextRequest("http://localhost:3000/__nextgen/v1/flow", {
        method: "GET",
        headers: { "x-real-ip": "192.168.1.1" },
      });
      await nextgenMiddleware(req, { url: "http://localhost:4000" });

      expect((capturedHeaders as Headers).get("x-forwarded-for")).toBe("192.168.1.1");
    });

    it("omits X-Forwarded-For when no IP source is available", async () => {
      let capturedHeaders: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          capturedHeaders = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );

      const req = new NextRequest("http://localhost:3000/__nextgen/v1/flow", {
        method: "GET",
        // No x-forwarded-for, no x-real-ip
      });
      await nextgenMiddleware(req, { url: "http://localhost:4000" });

      expect((capturedHeaders as Headers).has("x-forwarded-for")).toBe(false);
    });
  });

  describe("proxy: path-separator guard (W-2)", () => {
    it("does not proxy a path that only shares the proxyPath prefix without a separator", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

      // "/__nextgen-evil" starts with "/__nextgen" but the next char is "-", not "/"
      const req = new NextRequest("http://localhost:3000/__nextgen-evil/resource");
      await nextgenMiddleware(req, { url: "http://localhost:4000" });

      // With no token on a public route, fetch is never called (not proxied, no JWKS)
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it("proxies an exact match of proxyPath", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

      const req = new NextRequest("http://localhost:3000/__nextgen");
      const res = await nextgenMiddleware(req, {
        url: "http://localhost:4000",
      });

      expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
      expect(res.status).toBe(200);
    });

    it("proxies paths under proxyPath", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

      const req = new NextRequest("http://localhost:3000/__nextgen/v1/flow");
      const res = await nextgenMiddleware(req, {
        url: "http://localhost:4000",
      });

      expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
      expect(res.status).toBe(200);
    });
  });

  describe("inbound header override: x-nextgen-auth-token (T-1)", () => {
    it("overwrites client-supplied x-nextgen-auth-token with the verified value (empty for unauthenticated)", async () => {
      const req = new NextRequest("http://localhost:3000/", {
        headers: { "x-nextgen-auth-token": "forged-session-token" },
      });
      const res = await nextgenMiddleware(req, {
        url: "http://localhost:4000",
        protectedRoutes: ["/admin"],
      });

      // tunnelHeaders always overwrites x-nextgen-auth-token with the
      // middleware-determined value (empty string when unauthenticated).
      // The client's forged value must not survive into server components.
      const tunnelled =
        res.headers.get("x-nextgen-auth-token") ??
        res.headers.get("x-middleware-request-x-nextgen-auth-token");
      expect(tunnelled).toBe("");
      expect(tunnelled).not.toBe("forged-session-token");
    });

    it("overwrites client-supplied x-nextgen-auth-token with the real token when authenticated", async () => {
      const kid = nextKid();
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const token = makeJwt(
        {
          sub: "user-123",
          email: "user@example.com",
          iss: "http://localhost:4000",
          exp,
        },
        kid,
      );
      vi.stubGlobal("fetch", mockJwks(kid));

      const req = makeRequest("http://localhost:3000/admin", `__nextgen_session=${token}`);
      // Inject a fake x-nextgen-auth-token alongside the real cookie
      Object.defineProperty(req, "headers", {
        value: new Headers({
          cookie: `__nextgen_session=${token}`,
          "x-nextgen-auth-token": "forged-session-token",
        }),
        writable: false,
      });

      const res = await nextgenMiddleware(req, {
        url: "http://localhost:4000",
        protectedRoutes: ["/admin"],
      });

      // The tunnelled value must be the real verified token, not the forged one
      const tunnelled =
        res.headers.get("x-nextgen-auth-token") ??
        res.headers.get("x-middleware-request-x-nextgen-auth-token");
      expect(tunnelled).toBe(token);
      expect(tunnelled).not.toBe("forged-session-token");
    });

    it("neutralises client-supplied x-nextgen-auth-token on ignored routes (R-3)", async () => {
      const req = new NextRequest("http://localhost:3000/health", {
        headers: { "x-nextgen-auth-token": "forged-session-token" },
      });
      const res = await nextgenMiddleware(req, {
        url: "http://localhost:4000",
        ignoredRoutes: ["/health"],
      });

      const tunnelled =
        res.headers.get("x-nextgen-auth-token") ??
        res.headers.get("x-middleware-request-x-nextgen-auth-token");
      expect(tunnelled).toBe("");
      expect(tunnelled).not.toBe("forged-session-token");
    });
  });
});
