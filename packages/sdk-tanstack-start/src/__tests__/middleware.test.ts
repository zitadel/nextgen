/**
 * Contract tests for the TanStack Start integration. The bulk targets the pure
 * {@link handleNextgenRequest} core (Web `Request` in, a decision out) which
 * carries the full auth contract; a smaller set verifies the
 * {@link createNextgenRequestMiddleware} adapter wires that decision onto
 * TanStack's `next({ context })` / short-circuit-`Response` surface. Assertions
 * mirror the sdk-nuxt middleware contract.
 */

import { generateKeyPairSync, createSign } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { handleNextgenRequest, createNextgenRequestMiddleware, getAuth } from "../middleware";
import { clearJwksCache } from "@zitadel/sdk-core/jwt";

// The JWKS cache is module-level and per issuer: start every case from a cold
// cache, so each one fetches the keys its own mock publishes.
beforeEach(() => {
  clearJwksCache();
});

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyJwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;

let kidCounter = 0;
function nextKid(): string {
  return `tanstack-test-key-${++kidCounter}`;
}

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
  const sig = createSign("SHA256").update(signing).sign(privateKeyPem);
  return `${signing}.${base64url(sig)}`;
}

interface MakeRequestOptions {
  readonly cookie?: string;
  readonly authorization?: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
}

function makeRequest(url: string, opts: MakeRequestOptions = {}): Request {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.authorization) headers.authorization = opts.authorization;
  return new Request(url, { method: opts.method ?? "GET", headers });
}

function ts(offsetSeconds: number): number {
  return Math.floor(Date.now() / 1000) + offsetSeconds;
}

describe("handleNextgenRequest", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("continues as unauthenticated on a public route with no token", async () => {
    const decision = await handleNextgenRequest(makeRequest("http://localhost:3000/"), {
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });
    expect(decision).toEqual({
      type: "continue",
      auth: { isAuthenticated: false, session: null },
    });
  });

  it("redirects to /login?next=/admin on a protected route with no token", async () => {
    const decision = await handleNextgenRequest(makeRequest("http://localhost:3000/admin"), {
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });
    expect(decision.type).toBe("redirect");
    if (decision.type !== "redirect") throw new Error("expected redirect");
    expect(decision.response.status).toBe(302);
    const location = decision.response.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("next=%2Fadmin");
  });

  it("continues authenticated with a valid cookie token", async () => {
    const kid = nextKid();
    const token = makeJwt(
      { sub: "user-ts", email: "ts@example.com", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
    );
    vi.stubGlobal("fetch", mockJwks(kid));

    const decision = await handleNextgenRequest(
      makeRequest("http://localhost:3000/admin", { cookie: `__nextgen_session=${token}` }),
      { url: "http://localhost:4000", protectedRoutes: ["/admin"] },
    );

    expect(decision).toEqual({
      type: "continue",
      auth: {
        isAuthenticated: true,
        session: {
          userId: "user-ts",
          identifier: "ts@example.com",
          identifierProperty: null,
          display: null,
          token,
        },
      },
    });
  });

  it("gives the Bearer token precedence over the session cookie", async () => {
    const kid = nextKid();
    const bearerToken = makeJwt(
      { sub: "bearer", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
    );
    const cookieToken = makeJwt(
      { sub: "cookie", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
    );
    vi.stubGlobal("fetch", mockJwks(kid));

    const decision = await handleNextgenRequest(
      makeRequest("http://localhost:3000/", {
        cookie: `__nextgen_session=${cookieToken}`,
        authorization: `Bearer ${bearerToken}`,
      }),
      { url: "http://localhost:4000", protectedRoutes: [] },
    );

    expect(
      decision.type === "continue" && decision.auth.isAuthenticated && decision.auth.session.token,
    ).toBe(bearerToken);
  });

  it("redirects when the token has no sub on a protected route", async () => {
    const kid = nextKid();
    const token = makeJwt(
      { email: "ts@example.com", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
    );
    vi.stubGlobal("fetch", mockJwks(kid));

    const decision = await handleNextgenRequest(
      makeRequest("http://localhost:3000/admin", { cookie: `__nextgen_session=${token}` }),
      { url: "http://localhost:4000", protectedRoutes: ["/admin"] },
    );
    expect(decision.type).toBe("redirect");
  });

  it("rejects a disallowed typ on a protected route", async () => {
    const kid = nextKid();
    const token = makeJwt(
      { sub: "user-ts", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
      "refresh_token",
    );
    vi.stubGlobal("fetch", mockJwks(kid));

    const decision = await handleNextgenRequest(
      makeRequest("http://localhost:3000/admin", { cookie: `__nextgen_session=${token}` }),
      {
        url: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        allowedTokenTypes: ["JWT", "at+JWT"],
      },
    );
    expect(decision.type).toBe("redirect");
  });

  it('rejects alg "none" without fetching JWKS', async () => {
    const kid = nextKid();
    const token = makeJwt(
      { sub: "user-ts", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
      "JWT",
      "none",
    );
    vi.stubGlobal("fetch", vi.fn());

    const decision = await handleNextgenRequest(
      makeRequest("http://localhost:3000/admin", { cookie: `__nextgen_session=${token}` }),
      { url: "http://localhost:4000", protectedRoutes: ["/admin"] },
    );
    expect(decision.type).toBe("redirect");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("clears the stale session cookie on the redirect when the token is invalid", async () => {
    const kid = nextKid();
    const valid = makeJwt({ sub: "user-ts", iss: "http://localhost:4000", exp: ts(3600) }, kid);
    const parts = valid.split(".");
    const tampered = `${parts[0]}.${parts[1]}.invalidsig`;
    vi.stubGlobal("fetch", mockJwks(kid));

    const decision = await handleNextgenRequest(
      makeRequest("http://localhost:3000/admin", { cookie: `__nextgen_session=${tampered}` }),
      { url: "http://localhost:4000", protectedRoutes: ["/admin"] },
    );
    expect(decision.type).toBe("redirect");
    if (decision.type !== "redirect") throw new Error("expected redirect");
    const setCookie = decision.response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/__nextgen_session=/);
    expect(setCookie).toMatch(/Max-Age=0/i);
  });

  it("throws synchronously on an absolute loginPath", async () => {
    await expect(
      handleNextgenRequest(makeRequest("http://localhost:3000/admin"), {
        url: "http://localhost:4000",
        loginPath: "https://evil.test/x",
      }),
    ).rejects.toThrow(/loginPath must be a relative path/i);
  });

  describe("proxy", () => {
    it("strips x-nextgen-auth-token and forwards other headers", async () => {
      let captured: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          captured = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );

      const decision = await handleNextgenRequest(
        makeRequest("http://localhost:3000/__nextgen/v1/flow", {
          headers: { "x-nextgen-auth-token": "secret", "content-type": "application/json" },
        }),
        { url: "http://localhost:4000" },
      );

      expect(decision.type).toBe("proxy");
      expect(captured?.has("x-nextgen-auth-token")).toBe(false);
      expect(captured?.get("content-type")).toBe("application/json");
    });

    it("forwards upstream Set-Cookie", async () => {
      const upstreamHeaders = new Headers();
      upstreamHeaders.append("set-cookie", "__nextgen_session=abc; HttpOnly");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("{}", { status: 200, headers: upstreamHeaders })),
      );

      const decision = await handleNextgenRequest(
        makeRequest("http://localhost:3000/__nextgen/v1/flow"),
        { url: "http://localhost:4000" },
      );

      if (decision.type !== "proxy") throw new Error("expected proxy");
      expect(decision.response.headers.get("set-cookie")).toContain("__nextgen_session=abc");
    });

    // The IdP callback answers 303 back to the page sign-in started on: a
    // top-level navigation, so a dropped Location strands the browser.
    it.each([
      ["/profile?signed=1", "http://localhost:3000/profile?signed=1"],
      ["http://localhost:3000/profile", "http://localhost:3000/profile"],
      ["http://internal:4000/profile", "http://localhost:3000/profile"],
    ])("forwards an upstream Location %s onto this app as %s", async (location, expected) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(null, { status: 303, headers: { location } })),
      );

      const decision = await handleNextgenRequest(
        makeRequest("http://localhost:3000/__nextgen/idp/callback?code=x"),
        { url: "http://localhost:4000" },
      );

      if (decision.type !== "proxy") throw new Error("expected proxy");
      expect(decision.response.headers.get("location")).toBe(expected);
    });

    function captureUpstreamHeaders(): () => Headers | undefined {
      let captured: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          captured = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );
      return () => captured;
    }

    it("attaches the project secret to the handoff exchange", async () => {
      const captured = captureUpstreamHeaders();

      await handleNextgenRequest(
        makeRequest("http://localhost:3000/__nextgen/sessions/exchange", { method: "POST" }),
        { url: "http://localhost:4000", projectSecret: "sk-1" },
      );

      expect(captured()?.get("authorization")).toBe("Bearer sk-1");
    });

    // ADR 036: on any other operation the secret would make the public proxy
    // an open relay carrying project authority.
    it.each([
      ["GET", "/__nextgen/v1/flow"],
      ["POST", "/__nextgen/v1/flow"],
      ["GET", "/__nextgen/sessions/exchange"],
    ])("withholds the project secret from %s %s", async (method, path) => {
      const captured = captureUpstreamHeaders();

      await handleNextgenRequest(makeRequest(`http://localhost:3000${path}`, { method }), {
        url: "http://localhost:4000",
        projectSecret: "sk-1",
      });

      expect(captured()?.has("authorization")).toBe(false);
    });

    it("keeps a caller-supplied credential on the handoff exchange", async () => {
      const captured = captureUpstreamHeaders();

      await handleNextgenRequest(
        makeRequest("http://localhost:3000/__nextgen/sessions/exchange", {
          method: "POST",
          authorization: "Bearer pk-caller",
        }),
        { url: "http://localhost:4000", projectSecret: "sk-1" },
      );

      expect(captured()?.get("authorization")).toBe("Bearer pk-caller");
    });

    it("appends x-real-ip to the X-Forwarded-For chain", async () => {
      const captured = captureUpstreamHeaders();

      await handleNextgenRequest(
        makeRequest("http://localhost:3000/__nextgen/v1/flow", {
          headers: { "x-forwarded-for": "10.0.0.1", "x-real-ip": "10.0.0.2" },
        }),
        { url: "http://localhost:4000" },
      );

      expect(captured()?.get("x-forwarded-for")).toBe("10.0.0.1, 10.0.0.2");
    });

    it("does not proxy a path that only shares the prefix without a separator", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

      const decision = await handleNextgenRequest(
        makeRequest("http://localhost:3000/__nextgen-evil/resource"),
        { url: "http://localhost:4000" },
      );
      expect(decision.type).toBe("continue");
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });
  });

  it("continues (unauthenticated) on an ignored route", async () => {
    const decision = await handleNextgenRequest(makeRequest("http://localhost:3000/health"), {
      url: "http://localhost:4000",
      protectedRoutes: ["/health"],
      ignoredRoutes: ["/health"],
    });
    expect(decision).toEqual({ type: "continue", auth: { isAuthenticated: false, session: null } });
  });
});

describe("createNextgenRequestMiddleware", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls next with the auth context and returns its response on continue", async () => {
    const kid = nextKid();
    const token = makeJwt({ sub: "user-ts", iss: "http://localhost:4000", exp: ts(3600) }, kid);
    vi.stubGlobal("fetch", mockJwks(kid));

    const mw = createNextgenRequestMiddleware({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });
    const downstream = new Response("page", { status: 200 });
    const next = vi.fn().mockResolvedValue({ response: downstream });

    const res = await mw({
      request: makeRequest("http://localhost:3000/admin", { cookie: `__nextgen_session=${token}` }),
      next,
    });

    expect(next).toHaveBeenCalledOnce();
    const ctx = next.mock.calls[0]![0]!.context as { nextgenAuth: ReturnType<typeof getAuth> };
    expect(getAuth(ctx)).toMatchObject({ isAuthenticated: true, session: { userId: "user-ts" } });
    expect(res).toBe(downstream);
  });

  // A server function called where no request middleware ran has no context.
  it.each([[undefined], [{}]])("reads a missing session from %j as signed out", (context) => {
    expect(getAuth(context)).toEqual({ isAuthenticated: false, session: null });
  });

  it("returns the redirect response without calling next on a protected miss", async () => {
    const mw = createNextgenRequestMiddleware({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });
    const next = vi.fn();

    const res = await mw({ request: makeRequest("http://localhost:3000/admin"), next });

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/login");
  });
});

// The backend issues opaque session tokens; the middleware asks /sessions/me.
describe("opaque session cookie", () => {
  const COOKIE = "__nextgen_session=opaque-session-token";
  const OPTIONS = {
    url: "http://localhost:4000",
    protectedRoutes: ["/admin"],
    loginPath: "/login",
  };

  function sessionsMe(response: Response): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
  }

  it("signs in a live session that names a user, with the user's details", async () => {
    sessionsMe(
      Response.json({
        user_id: "u1",
        user: { identifier: "ada@example.com", identifier_property: "email", display: "Ada" },
      }),
    );

    const decision = await handleNextgenRequest(
      makeRequest("http://localhost:3000/admin", { cookie: COOKIE }),
      OPTIONS,
    );

    expect(decision).toMatchObject({
      type: "continue",
      auth: {
        isAuthenticated: true,
        session: { userId: "u1", identifier: "ada@example.com", display: "Ada" },
      },
    });
  });

  // CreateSession sets the cookie before any factor is verified: an abandoned
  // sign-in must not open protected routes.
  it("redirects an anonymous session on a protected route to login", async () => {
    sessionsMe(Response.json({}));

    const decision = await handleNextgenRequest(
      makeRequest("http://localhost:3000/admin", { cookie: COOKIE }),
      OPTIONS,
    );

    expect(decision.type).toBe("redirect");
  });

  it("keeps an anonymous session's cookie, since its sign-in may still complete", async () => {
    sessionsMe(Response.json({}));

    const decision = await handleNextgenRequest(
      makeRequest("http://localhost:3000/admin", { cookie: COOKIE }),
      OPTIONS,
    );

    if (decision.type !== "redirect") throw new Error("expected redirect");
    expect(decision.response.headers.get("set-cookie")).toBeNull();
  });

  it("clears a dead session cookie on a public page", async () => {
    sessionsMe(new Response(null, { status: 401 }));
    const mw = createNextgenRequestMiddleware(OPTIONS);
    const next = vi.fn().mockResolvedValue({ response: new Response("page", { status: 200 }) });

    const res = await mw({
      request: makeRequest("http://localhost:3000/", { cookie: COOKIE }),
      next,
    });

    expect(res.headers.get("set-cookie")).toContain("__nextgen_session=;");
  });
});
