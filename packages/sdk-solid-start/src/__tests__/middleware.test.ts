/**
 * Contract tests for the SolidStart `onRequest` handler produced by
 * {@link createNextgenMiddleware}. Each test builds a minimal `FetchEvent` — a
 * web-standard `Request`, a `locals` bag, and an optional `clientAddress` — and
 * invokes `config.onRequest[0](event)`. The handler returns a `Response` to
 * short-circuit (proxy / redirect) or `undefined` to continue, mirroring the
 * sdk-nuxt middleware contract.
 */

import { generateKeyPairSync, createSign } from "node:crypto";
import type { createMiddleware } from "@solidjs/start/middleware";
import { describe, it, expect, expectTypeOf, vi, beforeEach, afterEach } from "vitest";

import type { SolidFetchEvent } from "../middleware";

import { createNextgenMiddleware, getClientAuth } from "../middleware";
import { clearJwksCache } from "@zitadel/sdk-core/jwt";
import { clearSessionCheckBackoff } from "@zitadel/sdk-core/middleware";
import {
  DEAD,
  JWE_SESSION_TOKEN,
  OFF_ORIGIN_LOCATIONS,
  OUTAGES,
  PROXY_FAILURES,
  exchangeAnswer,
} from "./outages";

// The JWKS cache and the session-check backoff are module-level and per
// issuer: start every case cold, so each one asks its own mock, and keep the
// expected outage warnings out of the output.
beforeEach(() => {
  clearJwksCache();
  clearSessionCheckBackoff();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyJwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;

let kidCounter = 0;
function nextKid(): string {
  return `solidstart-test-key-${++kidCounter}`;
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

interface MakeEventOptions {
  readonly cookie?: string;
  readonly authorization?: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly clientAddress?: string;
}

function makeEvent(url: string, opts: MakeEventOptions = {}): SolidFetchEvent {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.authorization) headers.authorization = opts.authorization;
  return {
    request: new Request(url, { method: opts.method ?? "GET", headers }),
    locals: {},
    clientAddress: opts.clientAddress,
  };
}

function onRequest(
  config: ReturnType<typeof createNextgenMiddleware>,
  event: SolidFetchEvent,
): Promise<Response | undefined> {
  return config.onRequest[0]!(event);
}

function ts(offsetSeconds: number): number {
  return Math.floor(Date.now() / 1000) + offsetSeconds;
}

describe("createNextgenMiddleware (SolidStart)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("public route with no token sets locals to unauthenticated and continues", async () => {
    const mw = createNextgenMiddleware({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });
    const event = makeEvent("http://localhost:3000/");

    const res = await onRequest(mw, event);

    expect(res).toBeUndefined();
    expect(event.locals.nextgenAuth).toEqual({ isAuthenticated: false, session: null });
  });

  it("protected route with no token redirects to /login?next=/admin", async () => {
    const mw = createNextgenMiddleware({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });
    const event = makeEvent("http://localhost:3000/admin");

    const res = await onRequest(mw, event);

    expect(res?.status).toBe(302);
    const location = res?.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("next=%2Fadmin");
  });

  it("protected route with a valid cookie token sets locals to authenticated", async () => {
    const kid = nextKid();
    const token = makeJwt(
      { sub: "user-ss", email: "ss@example.com", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
    );
    vi.stubGlobal("fetch", mockJwks(kid));

    const mw = createNextgenMiddleware({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });
    const event = makeEvent("http://localhost:3000/admin", {
      cookie: `__nextgen_session=${token}`,
    });

    const res = await onRequest(mw, event);

    expect(res).toBeUndefined();
    expect(event.locals.nextgenAuth).toEqual({
      isAuthenticated: true,
      session: {
        userId: "user-ss",
        identifier: "ss@example.com",
        identifierProperty: null,
        display: null,
        token,
      },
    });
  });

  it("Bearer token takes precedence over the session cookie", async () => {
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

    const mw = createNextgenMiddleware({ url: "http://localhost:4000", protectedRoutes: [] });
    const event = makeEvent("http://localhost:3000/", {
      cookie: `__nextgen_session=${cookieToken}`,
      authorization: `Bearer ${bearerToken}`,
    });

    await onRequest(mw, event);

    const auth = event.locals.nextgenAuth;
    expect(auth?.isAuthenticated && auth.session.token).toBe(bearerToken);
  });

  it("token with no sub redirects on a protected route", async () => {
    const kid = nextKid();
    const token = makeJwt(
      { email: "ss@example.com", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
    );
    vi.stubGlobal("fetch", mockJwks(kid));

    const mw = createNextgenMiddleware({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });
    const event = makeEvent("http://localhost:3000/admin", {
      cookie: `__nextgen_session=${token}`,
    });

    const res = await onRequest(mw, event);
    expect(res?.status).toBe(302);
    expect(event.locals.nextgenAuth).toEqual({ isAuthenticated: false, session: null });
  });

  it("rejects a disallowed typ on a protected route", async () => {
    const kid = nextKid();
    const token = makeJwt(
      { sub: "user-ss", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
      "refresh_token",
    );
    vi.stubGlobal("fetch", mockJwks(kid));

    const mw = createNextgenMiddleware({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      allowedTokenTypes: ["JWT", "at+JWT"],
    });
    const event = makeEvent("http://localhost:3000/admin", {
      cookie: `__nextgen_session=${token}`,
    });

    expect((await onRequest(mw, event))?.status).toBe(302);
  });

  it('rejects alg "none" without fetching JWKS', async () => {
    const kid = nextKid();
    const token = makeJwt(
      { sub: "user-ss", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
      "JWT",
      "none",
    );
    vi.stubGlobal("fetch", vi.fn());

    const mw = createNextgenMiddleware({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });
    const event = makeEvent("http://localhost:3000/admin", {
      cookie: `__nextgen_session=${token}`,
    });

    expect((await onRequest(mw, event))?.status).toBe(302);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("clears the stale session cookie and redirects when the token is invalid", async () => {
    const kid = nextKid();
    const valid = makeJwt({ sub: "user-ss", iss: "http://localhost:4000", exp: ts(3600) }, kid);
    const parts = valid.split(".");
    const tampered = `${parts[0]}.${parts[1]}.invalidsig`;
    vi.stubGlobal("fetch", mockJwks(kid));

    const mw = createNextgenMiddleware({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });
    const event = makeEvent("http://localhost:3000/admin", {
      cookie: `__nextgen_session=${tampered}`,
    });

    const res = await onRequest(mw, event);
    expect(res?.status).toBe(302);
    const setCookie = res?.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/__nextgen_session=/);
    expect(setCookie).toMatch(/Max-Age=0/i);
  });

  describe("loginPath validation", () => {
    // A visitor without a session would be redirected from /login to /login forever.
    it("warns at setup when protectedRoutes match the loginPath", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      createNextgenMiddleware({
        url: "http://localhost:4000",
        loginPath: "/solid-login",
        protectedRoutes: ["/*"],
      });

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('loginPath "/solid-login" is matched by protectedRoutes'),
      );
    });

    it("does not warn when ignoredRoutes exempt the loginPath from protectedRoutes", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      createNextgenMiddleware({
        url: "http://localhost:4000",
        loginPath: "/login",
        protectedRoutes: ["/*"],
        ignoredRoutes: ["/login"],
      });

      expect(warn).not.toHaveBeenCalled();
    });

    it("throws on an absolute loginPath", () => {
      expect(() =>
        createNextgenMiddleware({ url: "http://localhost:4000", loginPath: "https://evil.test/x" }),
      ).toThrow(/loginPath must be a relative path/i);
    });

    it.each(["/\\evil.test/x", "/\t/evil.test/x"])(
      "throws on loginPath %j, which a URL parser reads as another host",
      (loginPath) => {
        expect(() => createNextgenMiddleware({ url: "http://localhost:4000", loginPath })).toThrow(
          /loginPath must be a relative path/i,
        );
      },
    );

    it("throws on a protocol-relative loginPath", () => {
      expect(() =>
        createNextgenMiddleware({ url: "http://localhost:4000", loginPath: "//evil.test/x" }),
      ).toThrow(/loginPath must be a relative path/i);
    });
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

      const mw = createNextgenMiddleware({ url: "http://localhost:4000" });
      const event = makeEvent("http://localhost:3000/__nextgen/v1/flow", {
        headers: { "x-nextgen-auth-token": "secret", "content-type": "application/json" },
      });

      await onRequest(mw, event);
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

      const mw = createNextgenMiddleware({ url: "http://localhost:4000" });
      const res = await onRequest(mw, makeEvent("http://localhost:3000/__nextgen/v1/flow"));

      expect(res?.headers.get("set-cookie")).toContain("__nextgen_session=abc");
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

      const mw = createNextgenMiddleware({ url: "http://localhost:4000" });
      const res = await onRequest(
        mw,
        makeEvent("http://localhost:3000/__nextgen/idp/callback?code=x"),
      );

      expect(res?.headers.get("location")).toBe(expected);
    });

    it.each(OFF_ORIGIN_LOCATIONS)("keeps %s on this app", async (location) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status: 303, headers: { location } })),
      );

      const res = await onRequest(
        createNextgenMiddleware({ url: "http://localhost:4000" }),
        makeEvent("http://localhost:3000/__nextgen/idp/callback?code=x"),
      );

      expect(new URL(res?.headers.get("location") ?? "", "http://unset.invalid").hostname).toBe(
        "localhost",
      );
    });

    it("keeps the session token out of the exchange body the browser reads", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => exchangeAnswer()),
      );

      const res = await onRequest(
        createNextgenMiddleware({ url: "http://localhost:4000" }),
        makeEvent("http://localhost:3000/__nextgen/sessions/exchange", { method: "POST" }),
      );

      expect(await res?.text()).not.toContain(JWE_SESSION_TOKEN);
    });

    it("still sets the session cookie from the exchange", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => exchangeAnswer()),
      );

      const res = await onRequest(
        createNextgenMiddleware({ url: "http://localhost:4000" }),
        makeEvent("http://localhost:3000/__nextgen/sessions/exchange", { method: "POST" }),
      );

      expect(res?.headers.getSetCookie()).toEqual(exchangeAnswer().headers.getSetCookie());
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

      const mw = createNextgenMiddleware({ url: "http://localhost:4000", projectSecret: "sk-1" });
      await onRequest(
        mw,
        makeEvent("http://localhost:3000/__nextgen/sessions/exchange", { method: "POST" }),
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

      const mw = createNextgenMiddleware({ url: "http://localhost:4000", projectSecret: "sk-1" });
      await onRequest(mw, makeEvent(`http://localhost:3000${path}`, { method }));

      expect(captured()?.has("authorization")).toBe(false);
    });

    it("keeps a caller-supplied credential on the handoff exchange", async () => {
      const captured = captureUpstreamHeaders();

      const mw = createNextgenMiddleware({ url: "http://localhost:4000", projectSecret: "sk-1" });
      await onRequest(
        mw,
        makeEvent("http://localhost:3000/__nextgen/sessions/exchange", {
          method: "POST",
          authorization: "Bearer pk-caller",
        }),
      );

      expect(captured()?.get("authorization")).toBe("Bearer pk-caller");
    });

    it("appends the client address to the X-Forwarded-For chain", async () => {
      let captured: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          captured = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );

      const mw = createNextgenMiddleware({ url: "http://localhost:4000" });
      const event = makeEvent("http://localhost:3000/__nextgen/v1/flow", {
        headers: { "x-forwarded-for": "10.0.0.1" },
        clientAddress: "10.0.0.2",
      });

      await onRequest(mw, event);
      const xff = captured?.get("x-forwarded-for") ?? "";
      expect(xff).toContain("10.0.0.1");
      expect(xff).toContain("10.0.0.2");
    });

    it("omits X-Forwarded-For when no client address is available", async () => {
      let captured: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          captured = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );

      const mw = createNextgenMiddleware({ url: "http://localhost:4000" });
      await onRequest(mw, makeEvent("http://localhost:3000/__nextgen/v1/flow"));
      expect(captured?.has("x-forwarded-for")).toBe(false);
    });

    it("does not proxy a path that only shares the prefix without a separator", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

      const mw = createNextgenMiddleware({ url: "http://localhost:4000" });
      const res = await onRequest(mw, makeEvent("http://localhost:3000/__nextgen-evil/resource"));

      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
      expect(res).toBeUndefined();
    });
  });

  describe("ignored routes", () => {
    it("skips auth handling on an ignored route", async () => {
      const mw = createNextgenMiddleware({
        url: "http://localhost:4000",
        protectedRoutes: ["/health"],
        ignoredRoutes: ["/health"],
      });
      const event = makeEvent("http://localhost:3000/health");

      const res = await onRequest(mw, event);
      expect(res).toBeUndefined();
      expect(event.locals.nextgenAuth).toBeUndefined();
    });
  });

  // The generated src/middleware.ts passes this config straight to SolidStart
  // 2's createMiddleware; a mismatch fails the scaffolded app's typecheck.
  // Checked by `tsc -p tsconfig.spec.json`.
  describe("SolidStart 2 compatibility", () => {
    it("is accepted by createMiddleware", () => {
      expectTypeOf(createNextgenMiddleware({ url: "http://localhost:4000" })).toExtend<
        Parameters<typeof createMiddleware>[0]
      >();
    });
  });
});

// The backend issues opaque session tokens; the middleware asks /sessions/me.
describe("opaque session cookie", () => {
  const COOKIE = "__nextgen_session=opaque-session-token";

  function sessionsMe(response: Response): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
  }

  function protectedMiddleware() {
    return createNextgenMiddleware({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });
  }

  it("checks a cookie shaped like the backend's own with the backend, not the JWKS", async () => {
    const backend = vi.fn(async (_url: string) =>
      Response.json({ session_id: "s1", user_id: "u1" }),
    );
    vi.stubGlobal("fetch", backend);
    const event = makeEvent("http://localhost:3000/admin", {
      cookie: `__nextgen_session=${JWE_SESSION_TOKEN}`,
    });

    await onRequest(protectedMiddleware(), event);

    expect([
      event.locals.nextgenAuth?.isAuthenticated,
      backend.mock.calls.map(([url]) => String(url)),
    ]).toEqual([true, ["http://localhost:4000/sessions/me"]]);
  });

  it("asks a client to retry a protected route when the backoff ends", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );

    const res = await onRequest(
      protectedMiddleware(),
      makeEvent("http://localhost:3000/admin", { cookie: COOKIE }),
    );

    expect(res?.headers.get("retry-after")).toBe("15");
  });

  it("signs in a live session that names a user, with the user's details", async () => {
    sessionsMe(
      Response.json({
        session_id: "s1",
        user_id: "u1",
        user: { identifier: "ada@example.com", identifier_property: "email", display: "Ada" },
      }),
    );
    const event = makeEvent("http://localhost:3000/admin", { cookie: COOKIE });

    await onRequest(protectedMiddleware(), event);

    expect(event.locals.nextgenAuth).toMatchObject({
      isAuthenticated: true,
      session: { userId: "u1", identifier: "ada@example.com", display: "Ada" },
    });
  });

  // CreateSession sets the cookie before any factor is verified: an abandoned
  // sign-in must not open protected routes.
  it("redirects an anonymous session on a protected route to login", async () => {
    sessionsMe(Response.json({ session_id: "s1" }));

    const res = await onRequest(
      protectedMiddleware(),
      makeEvent("http://localhost:3000/admin", { cookie: COOKIE }),
    );

    expect(res?.status).toBe(302);
  });

  it("keeps an anonymous session's cookie, since its sign-in may still complete", async () => {
    sessionsMe(Response.json({ session_id: "s1" }));

    const res = await onRequest(
      protectedMiddleware(),
      makeEvent("http://localhost:3000/admin", { cookie: COOKIE }),
    );

    expect(res?.headers.get("set-cookie")).toBeNull();
  });

  it("clears a dead session cookie on a public page", async () => {
    sessionsMe(Response.json({ code: "auth.unauthorized", message: "gone" }, { status: 401 }));
    const event = {
      ...makeEvent("http://localhost:3000/", { cookie: COOKIE }),
      response: { headers: new Headers() },
    };

    await onRequest(protectedMiddleware(), event);

    expect(event.response.headers.get("set-cookie")).toContain("__nextgen_session=;");
  });

  it.each(DEAD)("clears the cookie and redirects on a protected route for %s", async (_l, res) => {
    sessionsMe(res());

    const response = await onRequest(
      protectedMiddleware(),
      makeEvent("http://localhost:3000/admin", { cookie: COOKIE }),
    );

    expect([response?.status, response?.headers.getSetCookie()]).toEqual([
      302,
      ["__nextgen_session=; Path=/; Max-Age=0"],
    ]);
  });

  // A backend outage is not a sign-out: the cookie must survive it.
  it.each(OUTAGES)("keeps the cookie on a public page for %s", async (_l, fail) => {
    vi.stubGlobal("fetch", vi.fn(fail));
    const event = {
      ...makeEvent("http://localhost:3000/", { cookie: COOKIE }),
      response: { headers: new Headers() },
    };

    const response = await onRequest(protectedMiddleware(), event);

    expect([response, event.response.headers.getSetCookie(), event.locals.nextgenAuth]).toEqual([
      undefined,
      [],
      { isAuthenticated: false, session: null, reason: "unavailable" },
    ]);
  });

  it.each(OUTAGES)("answers a protected route 503 for %s", async (_l, fail) => {
    vi.stubGlobal("fetch", vi.fn(fail));

    const response = await onRequest(
      protectedMiddleware(),
      makeEvent("http://localhost:3000/admin", { cookie: COOKIE }),
    );

    expect([
      response?.status,
      response?.headers.get("location"),
      response?.headers.getSetCookie(),
    ]).toEqual([503, null, []]);
  });

  // A cookie the backend cannot have minted must not reach it, or read as an outage.
  it("clears a malformed session cookie on a protected route without asking the backend", async () => {
    const backend = vi.fn(async () => Response.json({ session_id: "s1", user_id: "u1" }));
    vi.stubGlobal("fetch", backend);

    const response = await onRequest(
      protectedMiddleware(),
      makeEvent("http://localhost:3000/admin", { cookie: "__nextgen_session=x%0Ay" }),
    );

    expect([response?.status, response?.headers.getSetCookie(), backend.mock.calls]).toEqual([
      302,
      ["__nextgen_session=; Path=/; Max-Age=0"],
      [],
    ]);
  });

  it("keeps signing in a live session after a malformed cookie and a 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) =>
        new Headers(init.headers).get("cookie") === COOKIE
          ? Response.json({ session_id: "s1", user_id: "u1" })
          : new Response(null, { status: 500 }),
      ),
    );
    for (const cookie of ["__nextgen_session=x%0Ay", "__nextgen_session=poison"]) {
      await onRequest(protectedMiddleware(), makeEvent("http://localhost:3000/admin", { cookie }));
    }
    const event = makeEvent("http://localhost:3000/admin", { cookie: COOKIE });

    await onRequest(protectedMiddleware(), event);

    expect(event.locals.nextgenAuth).toMatchObject({ isAuthenticated: true });
  });
});

// A JWKS that cannot be fetched on a cold cache says nothing about a JWT.
describe("JWT session during a JWKS outage", () => {
  function jwtCookie(): string {
    const token = makeJwt({ sub: "u1", iss: "http://localhost:4000", exp: ts(3600) }, nextKid());
    return `__nextgen_session=${token}`;
  }

  function protectedMiddleware() {
    return createNextgenMiddleware({ url: "http://localhost:4000", protectedRoutes: ["/admin"] });
  }

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("answers a protected route 503 and keeps the cookie", async () => {
    const response = await onRequest(
      protectedMiddleware(),
      makeEvent("http://localhost:3000/admin", { cookie: jwtCookie() }),
    );

    expect([response?.status, response?.headers.getSetCookie()]).toEqual([503, []]);
  });

  it("continues a public route as unavailable, keeping the cookie", async () => {
    const event = {
      ...makeEvent("http://localhost:3000/", { cookie: jwtCookie() }),
      response: { headers: new Headers() },
    };

    const response = await onRequest(protectedMiddleware(), event);

    expect([response, event.response.headers.getSetCookie(), event.locals.nextgenAuth]).toEqual([
      undefined,
      [],
      { isAuthenticated: false, session: null, reason: "unavailable" },
    ]);
  });
});

describe("getClientAuth", () => {
  it("drops the session token from the server-side auth", () => {
    const event = makeEvent("http://localhost:3000/");
    event.locals.nextgenAuth = {
      isAuthenticated: true,
      session: {
        userId: "u1",
        identifier: null,
        identifierProperty: null,
        display: "Ada",
        token: "t",
      },
    };

    expect(getClientAuth(event)).toEqual({
      isAuthenticated: true,
      session: { userId: "u1", identifier: null, identifierProperty: null, display: "Ada" },
    });
  });
});

describe("proxy upstream failure", () => {
  it.each(PROXY_FAILURES)("answers %s with %i", async (_l, status, code, fail) => {
    vi.stubGlobal("fetch", vi.fn(fail));

    const response = await onRequest(
      createNextgenMiddleware({ url: "http://localhost:4000" }),
      makeEvent("http://localhost:3000/__nextgen/v1/flow"),
    );

    expect([response?.status, await response?.json()]).toEqual([
      status,
      { code, message: expect.any(String) },
    ]);
  });
});
