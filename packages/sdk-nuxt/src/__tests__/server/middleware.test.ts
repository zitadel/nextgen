import { createApp, toWebHandler, getRequestHeader } from "h3";
import { generateKeyPairSync, createSign } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { createNextgenMiddleware } from "../../runtime/server/middleware";
import { setRuntimeConfig } from "../stubs/nuxt-imports";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyJwk = publicKey.export({
  type: "spki",
  format: "jwk",
}) as Record<string, unknown>;

/**
 * Monotonically increasing key-ID counter. Each test that exercises JWKS
 * lookup receives a unique `kid`, which maps to a unique cache entry in the
 * module-level JWKS cache inside `lib/jwt.ts`. This keeps tests hermetically
 * isolated without requiring a cache-reset export.
 */
let kidCounter = 0;
function nextKid(): string {
  return `nuxt-test-key-${++kidCounter}`;
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

/**
 * Stubs the opaque-token fallback path: `/sessions/me` answers `status` with
 * the given body, anything else (a JWKS lookup) 404s so the JWT path cannot
 * accidentally succeed.
 */
function mockSessionsMe(body: Record<string, unknown>, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((url: string) => {
    const res = String(url).endsWith("/sessions/me")
      ? new Response(JSON.stringify(body), { status })
      : new Response("{}", { status: 404 });
    return Promise.resolve(res);
  });
}

function makeWebRequest(
  url: string,
  cookie?: string,
  authorization?: string,
  method = "GET",
): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers["cookie"] = cookie;
  if (authorization) headers["authorization"] = authorization;
  return new Request(url, { headers, method });
}

describe("createNextgenMiddleware (H3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setRuntimeConfig({ nextgen: {} });
  });

  it("public route with no token sets nextgenAuth to unauthenticated", async () => {
    const app = createApp();
    app.use(
      createNextgenMiddleware({
        url: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        loginPath: "/login",
      }),
    );

    let capturedAuth: unknown = undefined;
    app.use("/", (event) => {
      capturedAuth = event.context.nextgenAuth;
      return { ok: true };
    });

    const handler = toWebHandler(app);
    const res = await handler(makeWebRequest("http://localhost:3000/"));
    expect(res.status).not.toBe(302);
    expect(capturedAuth).toEqual({ isAuthenticated: false, session: null });
  });

  it("protected route with no token redirects to /login?next=/admin", async () => {
    const app = createApp();
    app.use(
      createNextgenMiddleware({
        url: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        loginPath: "/login",
      }),
    );
    app.use("/admin", () => ({ ok: true }));

    const handler = toWebHandler(app);
    const res = await handler(makeWebRequest("http://localhost:3000/admin"));
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("next=%2Fadmin");
  });

  it("protected route with valid token sets nextgenAuth to authenticated", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt(
      {
        sub: "user-nuxt",
        email: "nuxt@example.com",
        iss: "http://localhost:4000",
        exp,
      },
      kid,
    );

    vi.stubGlobal("fetch", mockJwks(kid));

    const app = createApp();
    app.use(
      createNextgenMiddleware({
        url: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        loginPath: "/login",
      }),
    );

    let capturedAuth: unknown = undefined;
    app.use("/admin", (event) => {
      capturedAuth = event.context.nextgenAuth;
      return { ok: true };
    });

    const handler = toWebHandler(app);
    const res = await handler(
      makeWebRequest("http://localhost:3000/admin", `__nextgen_session=${token}`),
    );
    expect(res.status).not.toBe(302);
    expect(capturedAuth).toEqual({
      isAuthenticated: true,
      session: {
        userId: "user-nuxt",
        identifier: "nuxt@example.com",
        identifierProperty: null,
        display: null,
        token,
      },
    });
  });

  it("protected route with valid Bearer token sets nextgenAuth to authenticated", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt(
      {
        sub: "user-nuxt",
        email: "nuxt@example.com",
        iss: "http://localhost:4000",
        exp,
      },
      kid,
    );

    vi.stubGlobal("fetch", mockJwks(kid));

    const app = createApp();
    app.use(
      createNextgenMiddleware({
        url: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        loginPath: "/login",
      }),
    );

    let capturedAuth: unknown = undefined;
    app.use("/admin", (event) => {
      capturedAuth = event.context.nextgenAuth;
      return { ok: true };
    });

    const handler = toWebHandler(app);
    const res = await handler(
      makeWebRequest("http://localhost:3000/admin", undefined, `Bearer ${token}`),
    );
    expect(res.status).not.toBe(302);
    expect(capturedAuth).toEqual({
      isAuthenticated: true,
      session: {
        userId: "user-nuxt",
        identifier: "nuxt@example.com",
        identifierProperty: null,
        display: null,
        token,
      },
    });
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

    const app = createApp();
    app.use(
      createNextgenMiddleware({
        url: "http://localhost:4000",
        protectedRoutes: [],
      }),
    );

    let capturedAuth: unknown = undefined;
    app.use("/", (event) => {
      capturedAuth = event.context.nextgenAuth;
      return { ok: true };
    });

    const handler = toWebHandler(app);
    await handler(
      makeWebRequest(
        "http://localhost:3000/",
        `__nextgen_session=${cookieToken}`,
        `Bearer ${bearerToken}`,
      ),
    );

    const auth = capturedAuth as {
      isAuthenticated: boolean;
      session: { token: string };
    };
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.session.token).toBe(bearerToken);
    expect(auth.session.token).not.toBe(cookieToken);
  });

  it("token with no sub claim is treated as unauthenticated", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt({ email: "nuxt@example.com", exp }, kid);

    vi.stubGlobal("fetch", mockJwks(kid));

    const app = createApp();
    app.use(
      createNextgenMiddleware({
        url: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        loginPath: "/login",
      }),
    );

    let capturedAuth: unknown = undefined;
    app.use("/admin", (event) => {
      capturedAuth = event.context.nextgenAuth;
      return { ok: true };
    });

    const handler = toWebHandler(app);
    const res = await handler(
      makeWebRequest("http://localhost:3000/admin", `__nextgen_session=${token}`),
    );
    expect(res.status).toBe(302);
    expect(capturedAuth).toBeUndefined();
  });

  it("token without sub on public route sets nextgenAuth to unauthenticated", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt({ email: "nuxt@example.com", iss: "http://localhost:4000", exp }, kid);

    vi.stubGlobal("fetch", mockJwks(kid));

    const app = createApp();
    app.use(
      createNextgenMiddleware({
        url: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        loginPath: "/login",
      }),
    );

    let capturedAuth: unknown = undefined;
    app.use("/", (event) => {
      capturedAuth = event.context.nextgenAuth;
      return { ok: true };
    });

    const handler = toWebHandler(app);
    const res = await handler(
      makeWebRequest("http://localhost:3000/", `__nextgen_session=${token}`),
    );

    expect(res.status).not.toBe(302);
    expect(capturedAuth).toEqual({ isAuthenticated: false, session: null });
  });

  it("token with disallowed typ is rejected on protected route", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt(
      { sub: "user-nuxt", email: "nuxt@example.com", exp },
      kid,
      "refresh_token",
    );

    vi.stubGlobal("fetch", mockJwks(kid));

    const app = createApp();
    app.use(
      createNextgenMiddleware({
        url: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        allowedTokenTypes: ["JWT", "at+JWT"],
      }),
    );
    app.use("/admin", () => ({ ok: true }));

    const handler = toWebHandler(app);
    const res = await handler(
      makeWebRequest("http://localhost:3000/admin", `__nextgen_session=${token}`),
    );
    expect(res.status).toBe(302);
  });

  it("token with disallowed algorithm is rejected on protected route", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt({ sub: "user-nuxt", email: "nuxt@example.com", exp }, kid);

    vi.stubGlobal("fetch", mockJwks(kid));

    const app = createApp();
    app.use(
      createNextgenMiddleware({
        url: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        allowedAlgorithms: ["ES256"],
      }),
    );
    app.use("/admin", () => ({ ok: true }));

    const handler = toWebHandler(app);
    const res = await handler(
      makeWebRequest("http://localhost:3000/admin", `__nextgen_session=${token}`),
    );
    expect(res.status).toBe(302);
  });

  it("accepts RS256 tokens by default (allowedAlgorithms defaults to RS256/ES256)", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt(
      {
        sub: "user-nuxt",
        email: "nuxt@example.com",
        iss: "http://localhost:4000",
        exp,
      },
      kid,
    );

    vi.stubGlobal("fetch", mockJwks(kid));

    const app = createApp();
    // No allowedAlgorithms specified — defaults to ['RS256', 'ES256']
    app.use(
      createNextgenMiddleware({
        url: "http://localhost:4000",
        protectedRoutes: ["/admin"],
      }),
    );

    let capturedAuth: unknown = undefined;
    app.use("/admin", (event) => {
      capturedAuth = event.context.nextgenAuth;
      return { ok: true };
    });

    const handler = toWebHandler(app);
    const res = await handler(
      makeWebRequest("http://localhost:3000/admin", `__nextgen_session=${token}`),
    );

    expect(res.status).not.toBe(302);
    const auth = capturedAuth as { isAuthenticated: boolean };
    expect(auth.isAuthenticated).toBe(true);
  });

  it("redirect preserves existing query params in loginPath", async () => {
    const app = createApp();
    app.use(
      createNextgenMiddleware({
        url: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        loginPath: "/login?tab=sso",
      }),
    );
    app.use("/admin", () => ({ ok: true }));

    const handler = toWebHandler(app);
    const res = await handler(makeWebRequest("http://localhost:3000/admin"));
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    const parsed = new URL(location, "http://localhost:3000");
    expect(parsed.searchParams.get("tab")).toBe("sso");
    expect(parsed.searchParams.get("next")).toBe("/admin");
  });

  it("protected route with invalid token clears cookie and redirects", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const validToken = makeJwt({ sub: "user-nuxt", email: "nuxt@example.com", exp }, kid);
    const parts = validToken.split(".");
    const tamperedToken = `${parts[0]}.${parts[1]}.invalidsig`;

    vi.stubGlobal("fetch", mockJwks(kid));

    const app = createApp();
    app.use(
      createNextgenMiddleware({
        url: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        loginPath: "/login",
      }),
    );
    app.use("/admin", () => ({ ok: true }));

    const handler = toWebHandler(app);
    const res = await handler(
      makeWebRequest("http://localhost:3000/admin", `__nextgen_session=${tamperedToken}`),
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
  });

  it("redirect response includes Set-Cookie to clear stale session cookie", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const validToken = makeJwt({ sub: "user-nuxt", email: "nuxt@example.com", exp }, kid);
    const parts = validToken.split(".");
    const tamperedToken = `${parts[0]}.${parts[1]}.invalidsig`;

    vi.stubGlobal("fetch", mockJwks(kid));

    const app = createApp();
    app.use(
      createNextgenMiddleware({
        url: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        loginPath: "/login",
      }),
    );
    app.use("/admin", () => ({ ok: true }));

    const handler = toWebHandler(app);
    const res = await handler(
      makeWebRequest("http://localhost:3000/admin", `__nextgen_session=${tamperedToken}`),
    );

    expect(res.status).toBe(302);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/__nextgen_session=/);
    expect(setCookie).toMatch(/Max-Age=0|expires=.*1970/i);
  });

  it('token with alg "none" is rejected on a protected route', async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt(
      {
        sub: "user-nuxt",
        email: "nuxt@example.com",
        iss: "http://localhost:4000",
        exp,
      },
      kid,
      "JWT",
      "none",
    );

    vi.stubGlobal("fetch", vi.fn());

    const app = createApp();
    app.use(
      createNextgenMiddleware({
        url: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        loginPath: "/login",
      }),
    );
    app.use("/admin", () => ({ ok: true }));

    const handler = toWebHandler(app);
    const res = await handler(
      makeWebRequest("http://localhost:3000/admin", `__nextgen_session=${token}`),
    );
    expect(res.status).toBe(302);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("opaque session token with a user id authenticates as that user", async () => {
    vi.stubGlobal("fetch", mockSessionsMe({ user_id: "user-opaque" }));

    const app = createApp();
    app.use(
      createNextgenMiddleware({
        url: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        loginPath: "/login",
      }),
    );

    let capturedAuth: unknown = undefined;
    app.use("/", (event) => {
      capturedAuth = event.context.nextgenAuth;
      return { ok: true };
    });

    const handler = toWebHandler(app);
    await handler(makeWebRequest("http://localhost:3000/", "__nextgen_session=opaque-token"));
    expect(capturedAuth).toEqual({
      isAuthenticated: true,
      session: {
        userId: "user-opaque",
        identifier: null,
        identifierProperty: null,
        display: null,
        token: "opaque-token",
      },
    });
  });

  it("opaque session token without a user id stays unauthenticated but keeps its cookie", async () => {
    // An anonymous session: the flow has not verified a user factor yet, so
    // `/sessions/me` answers 200 with no `user_id`. Authenticating here would
    // hand route handlers a placeholder identity matching no real user — but
    // the session is live, so clearing its cookie would orphan the login flow
    // that is still completing it.
    vi.stubGlobal("fetch", mockSessionsMe({}));

    const app = createApp();
    app.use(
      createNextgenMiddleware({
        url: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        loginPath: "/login",
      }),
    );

    let capturedAuth: unknown = undefined;
    app.use("/", (event) => {
      capturedAuth = event.context.nextgenAuth;
      return { ok: true };
    });

    const handler = toWebHandler(app);
    const res = await handler(
      makeWebRequest("http://localhost:3000/", "__nextgen_session=opaque-token"),
    );
    expect(capturedAuth).toEqual({ isAuthenticated: false, session: null });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("dead opaque session token is cleared from the browser", async () => {
    // The backend no longer knows the session (revoked or expired), so the
    // sweep must clear the cookie to stop the browser from replaying it.
    vi.stubGlobal("fetch", mockSessionsMe({}, 401));

    const app = createApp();
    app.use(
      createNextgenMiddleware({
        url: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        loginPath: "/login",
      }),
    );

    let capturedAuth: unknown = undefined;
    app.use("/", (event) => {
      capturedAuth = event.context.nextgenAuth;
      return { ok: true };
    });

    const handler = toWebHandler(app);
    const res = await handler(
      makeWebRequest("http://localhost:3000/", "__nextgen_session=dead-token"),
    );
    expect(capturedAuth).toEqual({ isAuthenticated: false, session: null });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/__nextgen_session=/);
    expect(setCookie).toMatch(/Max-Age=0|expires=.*1970/i);
  });

  it("strips x-nextgen-auth-token from proxied requests", async () => {
    let capturedHeaders: Headers | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        capturedHeaders = init.headers as Headers;
        return Promise.resolve(new Response("{}", { status: 200 }));
      }),
    );

    const app = createApp();
    app.use(createNextgenMiddleware({ url: "http://localhost:4000" }));

    const handler = toWebHandler(app);
    await handler(
      new Request("http://localhost:3000/__nextgen/v1/flow", {
        method: "GET",
        headers: {
          "x-nextgen-auth-token": "secret-session-token",
          "content-type": "application/json",
        },
      }),
    );

    expect(capturedHeaders).toBeDefined();
    expect((capturedHeaders as Headers).has("x-nextgen-auth-token")).toBe(false);
    expect((capturedHeaders as Headers).get("content-type")).toBe("application/json");
  });

  describe("proxy: cookie forwarding", () => {
    it("forwards upstream Set-Cookie headers as-is", async () => {
      const upstreamHeaders = new Headers();
      upstreamHeaders.append("set-cookie", "__nextgen_session=abc; HttpOnly; SameSite=Lax");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("{}", { status: 200, headers: upstreamHeaders })),
      );

      const app = createApp();
      app.use(createNextgenMiddleware({ url: "http://localhost:4000" }));

      const handler = toWebHandler(app);
      const res = await handler(makeWebRequest("http://localhost:3000/__nextgen/v1/flow"));

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
      setRuntimeConfig({ nextgen: { projectSecret: "project-secret" } });
      let capturedHeaders: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          capturedHeaders = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );
      const app = createApp();
      app.use(createNextgenMiddleware({ url: "http://localhost:4000" }));

      await toWebHandler(app)(
        makeWebRequest(`http://localhost:3000${pathname}`, undefined, undefined, method),
      );

      expect((capturedHeaders as Headers).has("authorization")).toBe(false);
    });

    it("attaches the project secret only to POST /sessions/exchange, ignoring the query", async () => {
      setRuntimeConfig({ nextgen: { projectSecret: "project-secret" } });
      let capturedHeaders: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          capturedHeaders = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );
      const app = createApp();
      app.use(createNextgenMiddleware({ url: "http://localhost:4000" }));

      await toWebHandler(app)(
        makeWebRequest(
          "http://localhost:3000/__nextgen/sessions/exchange?source=browser",
          undefined,
          undefined,
          "POST",
        ),
      );

      expect((capturedHeaders as Headers).get("authorization")).toBe("Bearer project-secret");
    });

    it("preserves an explicit caller credential on the exchange", async () => {
      setRuntimeConfig({ nextgen: { projectSecret: "project-secret" } });
      let capturedHeaders: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          capturedHeaders = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );
      const app = createApp();
      app.use(createNextgenMiddleware({ url: "http://localhost:4000" }));

      await toWebHandler(app)(
        makeWebRequest(
          "http://localhost:3000/__nextgen/sessions/exchange",
          undefined,
          "Bearer caller-key",
          "POST",
        ),
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
      const app = createApp();
      app.use(createNextgenMiddleware({ url: "http://localhost:4000" }));

      const response = await toWebHandler(app)(
        makeWebRequest("http://localhost:3000/__nextgen/sessions/me"),
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

      const app = createApp();
      app.use(createNextgenMiddleware({ url: "http://localhost:4000" }));

      const handler = toWebHandler(app);
      const res = await handler(new Request("http://localhost:3000/__nextgen/v1/flow"));

      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("content-type")).toBe("application/json");
    });
  });

  describe("loginPath validation (P-3)", () => {
    it("throws synchronously when loginPath is an absolute URL", () => {
      expect(() =>
        createNextgenMiddleware({
          url: "http://localhost:4000",
          protectedRoutes: ["/admin"],
          loginPath: "https://evil.example.com/phish",
        }),
      ).toThrow(/loginPath must be a relative path/i);
    });

    it("throws synchronously when loginPath is a protocol-relative URL", () => {
      expect(() =>
        createNextgenMiddleware({
          url: "http://localhost:4000",
          protectedRoutes: ["/admin"],
          loginPath: "//evil.example.com/phish",
        }),
      ).toThrow(/loginPath must be a relative path/i);
    });

    it("accepts a relative loginPath and redirects correctly", async () => {
      const app = createApp();
      app.use(
        createNextgenMiddleware({
          url: "http://localhost:4000",
          protectedRoutes: ["/admin"],
          loginPath: "/custom-login",
        }),
      );
      app.use("/admin", () => ({ ok: true }));

      const handler = toWebHandler(app);
      const res = await handler(makeWebRequest("http://localhost:3000/admin"));
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("/custom-login");
    });
  });

  describe("proxy: X-Forwarded-For append (P-4)", () => {
    it("appends socket IP to an existing X-Forwarded-For chain", async () => {
      let capturedHeaders: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          capturedHeaders = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );

      const app = createApp();
      // Inject a fake socket IP before the middleware runs so the handler can
      // read it as the direct client address (event.node.req.socket.remoteAddress).
      app.use((event) => {
        (event.node.req as unknown as { socket: { remoteAddress?: string } }).socket = {
          remoteAddress: "10.0.0.2",
        };
      });
      app.use(createNextgenMiddleware({ url: "http://localhost:4000" }));

      const handler = toWebHandler(app);
      await handler(
        new Request("http://localhost:3000/__nextgen/v1/flow", {
          headers: { "x-forwarded-for": "10.0.0.1" },
        }),
      );

      expect(capturedHeaders).toBeDefined();
      const xff = (capturedHeaders as Headers).get("x-forwarded-for") ?? "";
      // Both the CDN-set chain and the socket hop must appear
      expect(xff).toContain("10.0.0.1");
      expect(xff).toContain("10.0.0.2");
    });

    it("sets X-Forwarded-For from socket IP when no chain exists", async () => {
      let capturedHeaders: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          capturedHeaders = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );

      const app = createApp();
      app.use((event) => {
        (event.node.req as unknown as { socket: { remoteAddress?: string } }).socket = {
          remoteAddress: "10.0.0.2",
        };
      });
      app.use(createNextgenMiddleware({ url: "http://localhost:4000" }));

      const handler = toWebHandler(app);
      await handler(makeWebRequest("http://localhost:3000/__nextgen/v1/flow"));

      expect((capturedHeaders as Headers).get("x-forwarded-for")).toBe("10.0.0.2");
    });

    it("omits X-Forwarded-For when no socket IP is available", async () => {
      let capturedHeaders: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          capturedHeaders = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );

      const app = createApp();
      // No socket-patching middleware — socket.remoteAddress will be undefined
      app.use(createNextgenMiddleware({ url: "http://localhost:4000" }));

      const handler = toWebHandler(app);
      await handler(makeWebRequest("http://localhost:3000/__nextgen/v1/flow"));

      // Without a socket IP there is nothing to append
      expect((capturedHeaders as Headers).has("x-forwarded-for")).toBe(false);
    });
  });

  describe("proxy: path-separator guard (W-2)", () => {
    it("does not proxy a path that only shares the proxyPath prefix without a separator", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

      // "/__nextgen-evil" starts with "/__nextgen" but the next char is "-", not "/"
      const app = createApp();
      app.use(createNextgenMiddleware({ url: "http://localhost:4000" }));

      const handler = toWebHandler(app);
      await handler(makeWebRequest("http://localhost:3000/__nextgen-evil/resource"));

      // With no token on a public route, fetch is never called (not proxied, no JWKS)
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it("proxies an exact match of proxyPath", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

      const app = createApp();
      app.use(createNextgenMiddleware({ url: "http://localhost:4000" }));

      const handler = toWebHandler(app);
      const res = await handler(makeWebRequest("http://localhost:3000/__nextgen"));

      expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
      expect(res.status).toBe(200);
    });

    it("proxies paths under proxyPath", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

      const app = createApp();
      app.use(createNextgenMiddleware({ url: "http://localhost:4000" }));

      const handler = toWebHandler(app);
      const res = await handler(makeWebRequest("http://localhost:3000/__nextgen/v1/flow"));

      expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
      expect(res.status).toBe(200);
    });
  });

  describe("inbound header stripping: x-nextgen-auth-token (T-1)", () => {
    it("strips client-supplied x-nextgen-auth-token so route handlers cannot read it", async () => {
      const app = createApp();
      app.use(
        createNextgenMiddleware({
          url: "http://localhost:4000",
          protectedRoutes: [],
        }),
      );

      let capturedToken: string | undefined;
      app.use("/", (event) => {
        capturedToken = getRequestHeader(event, "x-nextgen-auth-token");
        return { ok: true };
      });

      const handler = toWebHandler(app);
      await handler(
        new Request("http://localhost:3000/", {
          headers: { "x-nextgen-auth-token": "forged-session-token" },
        }),
      );

      // The client-supplied value must not be visible to downstream handlers
      expect(capturedToken).toBeUndefined();
    });

    it("strips the header regardless of whether a valid session token is present", async () => {
      const kid = nextKid();
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const token = makeJwt(
        {
          sub: "user-nuxt",
          email: "nuxt@example.com",
          iss: "http://localhost:4000",
          exp,
        },
        kid,
      );
      vi.stubGlobal("fetch", mockJwks(kid));

      const app = createApp();
      app.use(
        createNextgenMiddleware({
          url: "http://localhost:4000",
          protectedRoutes: [],
        }),
      );

      let capturedToken: string | undefined;
      app.use("/", (event) => {
        capturedToken = getRequestHeader(event, "x-nextgen-auth-token");
        return { ok: true };
      });

      const handler = toWebHandler(app);
      await handler(
        new Request("http://localhost:3000/", {
          headers: {
            cookie: `__nextgen_session=${token}`,
            "x-nextgen-auth-token": "forged-session-token",
          },
        }),
      );

      // Even with a valid session cookie, the attacker-supplied header is gone
      expect(capturedToken).toBeUndefined();
    });

    it("strips client-supplied x-nextgen-auth-token on ignored routes (R-3)", async () => {
      const app = createApp();
      app.use(
        createNextgenMiddleware({
          url: "http://localhost:4000",
          ignoredRoutes: ["/health"],
        }),
      );

      let capturedToken: string | undefined;
      app.use("/health", (event) => {
        capturedToken = getRequestHeader(event, "x-nextgen-auth-token");
        return { ok: true };
      });

      const handler = toWebHandler(app);
      await handler(
        new Request("http://localhost:3000/health", {
          headers: { "x-nextgen-auth-token": "forged-session-token" },
        }),
      );

      expect(capturedToken).toBeUndefined();
    });
  });
});
