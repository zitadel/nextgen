/**
 * Contract tests for the SvelteKit `handle` hook produced by
 * {@link createNextgenHandle}. SvelteKit ships no lightweight in-process test
 * harness (unlike h3's `createApp`), so each test constructs a minimal
 * `RequestEvent` — a URL, a web-standard `Request`, an in-memory cookie jar,
 * `locals`, and `getClientAddress()` — plus a `resolve` spy, exactly the surface
 * the hook touches. The assertions mirror the sdk-nuxt middleware contract.
 */

import type { RequestEvent } from "@sveltejs/kit";
import type { Handle } from "@sveltejs/kit/hooks";

import { generateKeyPairSync, createSign } from "node:crypto";
import { describe, it, expect, expectTypeOf, vi, beforeEach, afterEach } from "vitest";

import { createNextgenHandle, getClientAuth } from "../handle";
import { clearJwksCache } from "@zitadel/sdk-core/jwt";
import { clearSessionCheckBackoff } from "@zitadel/sdk-core/middleware";
import { DEAD, OUTAGES, PROXY_FAILURES } from "./outages";

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
  return `sveltekit-test-key-${++kidCounter}`;
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
  readonly clientIp?: string;
}

/** A tiny in-memory cookie jar matching the slice of `Cookies` the hook uses. */
function makeCookieJar(cookieHeader: string | undefined) {
  const jar = new Map<string, string>();
  if (cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const idx = part.indexOf("=");
      if (idx === -1) continue;
      const name = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (name) jar.set(name, value);
    }
  }
  return {
    get: (name: string) => jar.get(name),
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => {
      jar.delete(name);
    },
  };
}

/** Builds a `RequestEvent`-shaped object covering the fields the hook reads. */
function makeEvent(
  url: string,
  opts: MakeEventOptions = {},
): { event: RequestEvent; resolve: ReturnType<typeof vi.fn> } {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.authorization) headers.authorization = opts.authorization;

  const request = new Request(url, { method: opts.method ?? "GET", headers });
  const cookies = makeCookieJar(opts.cookie);

  const event = {
    url: new URL(url),
    request,
    cookies,
    locals: {},
    getClientAddress: () => {
      if (!opts.clientIp) {
        throw new Error("Could not determine clientAddress");
      }
      return opts.clientIp;
    },
  } as unknown as RequestEvent;

  const resolve = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
  return { event, resolve };
}

function run(
  handle: Handle,
  event: RequestEvent,
  resolve: ReturnType<typeof vi.fn>,
): Promise<Response> {
  // The hook's second arg is `{ event, resolve }`; resolve also takes opts in
  // real SvelteKit, but the hook calls it with the event only.
  return handle({ event, resolve } as unknown as Parameters<Handle>[0]) as Promise<Response>;
}

describe("createNextgenHandle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("public route with no token sets locals to unauthenticated and resolves", async () => {
    const handle = createNextgenHandle({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });
    const { event, resolve } = makeEvent("http://localhost:3000/");

    const res = await run(handle, event, resolve);

    expect(resolve).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
    expect(event.locals.nextgenAuth).toEqual({ isAuthenticated: false, session: null });
  });

  it("protected route with no token redirects to /login?next=/admin", async () => {
    const handle = createNextgenHandle({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });
    const { event, resolve } = makeEvent("http://localhost:3000/admin");

    const res = await run(handle, event, resolve);

    expect(resolve).not.toHaveBeenCalled();
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("next=%2Fadmin");
  });

  it("protected route with a valid cookie token sets locals to authenticated", async () => {
    const kid = nextKid();
    const token = makeJwt(
      { sub: "user-sk", email: "sk@example.com", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
    );
    vi.stubGlobal("fetch", mockJwks(kid));

    const handle = createNextgenHandle({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });
    const { event, resolve } = makeEvent("http://localhost:3000/admin", {
      cookie: `__nextgen_session=${token}`,
    });

    const res = await run(handle, event, resolve);

    expect(res.status).toBe(200);
    expect(event.locals.nextgenAuth).toEqual({
      isAuthenticated: true,
      session: {
        userId: "user-sk",
        identifier: "sk@example.com",
        identifierProperty: null,
        display: null,
        token,
      },
    });
  });

  it("protected route with a valid Bearer token sets locals to authenticated", async () => {
    const kid = nextKid();
    const token = makeJwt(
      { sub: "user-sk", email: "sk@example.com", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
    );
    vi.stubGlobal("fetch", mockJwks(kid));

    const handle = createNextgenHandle({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });
    const { event, resolve } = makeEvent("http://localhost:3000/admin", {
      authorization: `Bearer ${token}`,
    });

    await run(handle, event, resolve);

    expect(event.locals.nextgenAuth).toMatchObject({
      isAuthenticated: true,
      session: { userId: "user-sk", token },
    });
  });

  it("Bearer token takes precedence over the session cookie when both are present", async () => {
    const kid = nextKid();
    const bearerToken = makeJwt(
      { sub: "bearer-user", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
    );
    const cookieToken = makeJwt(
      { sub: "cookie-user", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
    );
    vi.stubGlobal("fetch", mockJwks(kid));

    const handle = createNextgenHandle({ url: "http://localhost:4000", protectedRoutes: [] });
    const { event, resolve } = makeEvent("http://localhost:3000/", {
      cookie: `__nextgen_session=${cookieToken}`,
      authorization: `Bearer ${bearerToken}`,
    });

    await run(handle, event, resolve);

    const auth = event.locals.nextgenAuth;
    expect(auth?.isAuthenticated).toBe(true);
    expect(auth?.isAuthenticated && auth.session.token).toBe(bearerToken);
  });

  it("token with no sub claim is treated as unauthenticated and redirects on a protected route", async () => {
    const kid = nextKid();
    const token = makeJwt(
      { email: "sk@example.com", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
    );
    vi.stubGlobal("fetch", mockJwks(kid));

    const handle = createNextgenHandle({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });
    const { event, resolve } = makeEvent("http://localhost:3000/admin", {
      cookie: `__nextgen_session=${token}`,
    });

    const res = await run(handle, event, resolve);

    expect(res.status).toBe(302);
    expect(event.locals.nextgenAuth).toEqual({ isAuthenticated: false, session: null });
  });

  it("accepts RS256 tokens by default", async () => {
    const kid = nextKid();
    const token = makeJwt({ sub: "user-sk", iss: "http://localhost:4000", exp: ts(3600) }, kid);
    vi.stubGlobal("fetch", mockJwks(kid));

    const handle = createNextgenHandle({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });
    const { event, resolve } = makeEvent("http://localhost:3000/admin", {
      cookie: `__nextgen_session=${token}`,
    });

    await run(handle, event, resolve);
    expect(event.locals.nextgenAuth?.isAuthenticated).toBe(true);
  });

  it("rejects a token with a disallowed typ on a protected route", async () => {
    const kid = nextKid();
    const token = makeJwt(
      { sub: "user-sk", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
      "refresh_token",
    );
    vi.stubGlobal("fetch", mockJwks(kid));

    const handle = createNextgenHandle({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      allowedTokenTypes: ["JWT", "at+JWT"],
    });
    const { event, resolve } = makeEvent("http://localhost:3000/admin", {
      cookie: `__nextgen_session=${token}`,
    });

    const res = await run(handle, event, resolve);
    expect(res.status).toBe(302);
  });

  it("rejects a token with a disallowed algorithm on a protected route", async () => {
    const kid = nextKid();
    const token = makeJwt({ sub: "user-sk", iss: "http://localhost:4000", exp: ts(3600) }, kid);
    vi.stubGlobal("fetch", mockJwks(kid));

    const handle = createNextgenHandle({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      allowedAlgorithms: ["ES256"],
    });
    const { event, resolve } = makeEvent("http://localhost:3000/admin", {
      cookie: `__nextgen_session=${token}`,
    });

    const res = await run(handle, event, resolve);
    expect(res.status).toBe(302);
  });

  it('rejects alg "none" on a protected route without fetching JWKS', async () => {
    const kid = nextKid();
    const token = makeJwt(
      { sub: "user-sk", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
      "JWT",
      "none",
    );
    vi.stubGlobal("fetch", vi.fn());

    const handle = createNextgenHandle({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });
    const { event, resolve } = makeEvent("http://localhost:3000/admin", {
      cookie: `__nextgen_session=${token}`,
    });

    const res = await run(handle, event, resolve);
    expect(res.status).toBe(302);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("preserves existing query params in loginPath when redirecting", async () => {
    const handle = createNextgenHandle({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login?tab=sso",
    });
    const { event, resolve } = makeEvent("http://localhost:3000/admin");

    const res = await run(handle, event, resolve);
    expect(res.status).toBe(302);
    const parsed = new URL(res.headers.get("location") ?? "", "http://localhost:3000");
    expect(parsed.searchParams.get("tab")).toBe("sso");
    expect(parsed.searchParams.get("next")).toBe("/admin");
  });

  it("clears the stale session cookie and redirects when the token is invalid", async () => {
    const kid = nextKid();
    const valid = makeJwt({ sub: "user-sk", iss: "http://localhost:4000", exp: ts(3600) }, kid);
    const parts = valid.split(".");
    const tampered = `${parts[0]}.${parts[1]}.invalidsig`;
    vi.stubGlobal("fetch", mockJwks(kid));

    const handle = createNextgenHandle({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });
    const { event, resolve } = makeEvent("http://localhost:3000/admin", {
      cookie: `__nextgen_session=${tampered}`,
    });

    const res = await run(handle, event, resolve);
    expect(res.status).toBe(302);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/__nextgen_session=/);
    expect(setCookie).toMatch(/Max-Age=0/i);
  });

  describe("loginPath validation", () => {
    // A visitor without a session would be redirected from /login to /login forever.
    it("warns at setup when protectedRoutes match the loginPath", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      createNextgenHandle({
        url: "http://localhost:4000",
        loginPath: "/sveltekit-login",
        protectedRoutes: ["/*"],
      });

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('loginPath "/sveltekit-login" is matched by protectedRoutes'),
      );
    });

    it("does not warn when ignoredRoutes exempt the loginPath from protectedRoutes", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      createNextgenHandle({
        url: "http://localhost:4000",
        loginPath: "/login",
        protectedRoutes: ["/*"],
        ignoredRoutes: ["/login"],
      });

      expect(warn).not.toHaveBeenCalled();
    });

    it("throws synchronously when loginPath is an absolute URL", () => {
      expect(() =>
        createNextgenHandle({
          url: "http://localhost:4000",
          protectedRoutes: ["/admin"],
          loginPath: "https://evil.example.com/phish",
        }),
      ).toThrow(/loginPath must be a relative path/i);
    });

    it("throws synchronously when loginPath is a protocol-relative URL", () => {
      expect(() =>
        createNextgenHandle({
          url: "http://localhost:4000",
          protectedRoutes: ["/admin"],
          loginPath: "//evil.example.com/phish",
        }),
      ).toThrow(/loginPath must be a relative path/i);
    });
  });

  describe("proxy", () => {
    it("strips x-nextgen-auth-token from proxied requests", async () => {
      let capturedHeaders: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          capturedHeaders = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );

      const handle = createNextgenHandle({ url: "http://localhost:4000" });
      const { event, resolve } = makeEvent("http://localhost:3000/__nextgen/v1/flow", {
        headers: { "x-nextgen-auth-token": "secret", "content-type": "application/json" },
      });

      await run(handle, event, resolve);

      expect(resolve).not.toHaveBeenCalled();
      expect(capturedHeaders?.has("x-nextgen-auth-token")).toBe(false);
      expect(capturedHeaders?.get("content-type")).toBe("application/json");
    });

    it("forwards upstream Set-Cookie headers verbatim", async () => {
      const upstreamHeaders = new Headers();
      upstreamHeaders.append("set-cookie", "__nextgen_session=abc; HttpOnly; SameSite=Lax");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("{}", { status: 200, headers: upstreamHeaders })),
      );

      const handle = createNextgenHandle({ url: "http://localhost:4000" });
      const { event, resolve } = makeEvent("http://localhost:3000/__nextgen/v1/flow");

      const res = await run(handle, event, resolve);
      expect(res.headers.get("set-cookie")).toBe("__nextgen_session=abc; HttpOnly; SameSite=Lax");
    });

    // The IdP callback answers 303 back to the page sign-in started on: a
    // top-level navigation, so a dropped Location strands the browser.
    it.each([
      ["/profile?signed=1", "http://localhost:3000/profile?signed=1"],
      ["http://localhost:3000/profile", "http://localhost:3000/profile"],
      ["http://internal-auth.corp:4000/profile", "http://localhost:3000/profile"],
    ])("forwards an upstream Location %s onto this app as %s", async (location, expected) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(null, { status: 303, headers: { location } })),
      );

      const handle = createNextgenHandle({ url: "http://localhost:4000" });
      const { event, resolve } = makeEvent("http://localhost:3000/__nextgen/idp/callback?code=x");

      const res = await run(handle, event, resolve);
      expect(res.headers.get("location")).toBe(expected);
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

      const handle = createNextgenHandle({ url: "http://localhost:4000", projectSecret: "sk-123" });
      const { event, resolve } = makeEvent("http://localhost:3000/__nextgen/sessions/exchange", {
        method: "POST",
      });

      await run(handle, event, resolve);
      expect(captured()?.get("authorization")).toBe("Bearer sk-123");
    });

    // ADR 036: on any other operation the secret would make the public proxy
    // an open relay carrying project authority.
    it.each([
      ["GET", "/__nextgen/v1/flow"],
      ["POST", "/__nextgen/v1/flow"],
      ["GET", "/__nextgen/sessions/exchange"],
    ])("withholds the project secret from %s %s", async (method, path) => {
      const captured = captureUpstreamHeaders();

      const handle = createNextgenHandle({ url: "http://localhost:4000", projectSecret: "sk-123" });
      const { event, resolve } = makeEvent(`http://localhost:3000${path}`, { method });

      await run(handle, event, resolve);
      expect(captured()?.has("authorization")).toBe(false);
    });

    it("keeps a caller-supplied credential on the handoff exchange", async () => {
      const captured = captureUpstreamHeaders();

      const handle = createNextgenHandle({ url: "http://localhost:4000", projectSecret: "sk-123" });
      const { event, resolve } = makeEvent("http://localhost:3000/__nextgen/sessions/exchange", {
        method: "POST",
        authorization: "Bearer pk-caller",
      });

      await run(handle, event, resolve);
      expect(captured()?.get("authorization")).toBe("Bearer pk-caller");
    });

    it("does not proxy a path that only shares the prefix without a separator", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

      const handle = createNextgenHandle({ url: "http://localhost:4000" });
      const { event, resolve } = makeEvent("http://localhost:3000/__nextgen-evil/resource");

      await run(handle, event, resolve);
      // Public route, no token: not proxied (fetch never called) and resolved.
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
      expect(resolve).toHaveBeenCalledOnce();
    });
  });

  describe("X-Forwarded-For", () => {
    it("appends the client IP to an existing chain", async () => {
      let capturedHeaders: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          capturedHeaders = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );

      const handle = createNextgenHandle({ url: "http://localhost:4000" });
      const { event, resolve } = makeEvent("http://localhost:3000/__nextgen/v1/flow", {
        headers: { "x-forwarded-for": "10.0.0.1" },
        clientIp: "10.0.0.2",
      });

      await run(handle, event, resolve);
      const xff = capturedHeaders?.get("x-forwarded-for") ?? "";
      expect(xff).toContain("10.0.0.1");
      expect(xff).toContain("10.0.0.2");
    });

    it("sets the chain from the client IP when none exists", async () => {
      let capturedHeaders: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          capturedHeaders = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );

      const handle = createNextgenHandle({ url: "http://localhost:4000" });
      const { event, resolve } = makeEvent("http://localhost:3000/__nextgen/v1/flow", {
        clientIp: "10.0.0.2",
      });

      await run(handle, event, resolve);
      expect(capturedHeaders?.get("x-forwarded-for")).toBe("10.0.0.2");
    });

    it("omits the chain when no client IP is available", async () => {
      let capturedHeaders: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          capturedHeaders = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );

      const handle = createNextgenHandle({ url: "http://localhost:4000" });
      const { event, resolve } = makeEvent("http://localhost:3000/__nextgen/v1/flow");

      await run(handle, event, resolve);
      expect(capturedHeaders?.has("x-forwarded-for")).toBe(false);
    });
  });

  describe("ignored routes", () => {
    it("skips auth handling and resolves on an ignored route", async () => {
      const handle = createNextgenHandle({
        url: "http://localhost:4000",
        protectedRoutes: ["/health"],
        ignoredRoutes: ["/health"],
      });
      const { event, resolve } = makeEvent("http://localhost:3000/health");

      const res = await run(handle, event, resolve);
      // Ignored wins over protected: resolved, never redirected, locals untouched.
      expect(resolve).toHaveBeenCalledOnce();
      expect(res.status).toBe(200);
      expect(event.locals.nextgenAuth).toBeUndefined();
    });
  });
});

function ts(offsetSeconds: number): number {
  return Math.floor(Date.now() / 1000) + offsetSeconds;
}

// The hook is typed structurally (Kit 3 moved `Handle` out of `@sveltejs/kit`),
// so pin that it still drops in wherever Kit expects a `Handle`. Checked by
// `tsc -p tsconfig.spec.json`.
describe("SvelteKit Handle compatibility", () => {
  it("is assignable to SvelteKit's Handle", () => {
    expectTypeOf(createNextgenHandle({ url: "http://localhost:4000" })).toExtend<Handle>();
  });
});

// The backend issues opaque session tokens; the hook asks /sessions/me about them.
describe("opaque session cookie", () => {
  const COOKIE = "__nextgen_session=opaque-session-token";

  function sessionsMe(response: Response): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
  }

  function protectedHandle() {
    return createNextgenHandle({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });
  }

  it("signs in a live session that names a user, with the user's details", async () => {
    sessionsMe(
      Response.json({
        session_id: "s1",
        user_id: "u1",
        user: { identifier: "ada@example.com", identifier_property: "email", display: "Ada" },
      }),
    );
    const { event, resolve } = makeEvent("http://localhost:3000/admin", { cookie: COOKIE });

    await run(protectedHandle(), event, resolve);

    expect(event.locals.nextgenAuth).toMatchObject({
      isAuthenticated: true,
      session: { userId: "u1", identifier: "ada@example.com", display: "Ada" },
    });
  });

  // CreateSession sets the cookie before any factor is verified: an abandoned
  // sign-in must not open protected routes.
  it("redirects an anonymous session on a protected route to login", async () => {
    sessionsMe(Response.json({ session_id: "s1" }));
    const { event, resolve } = makeEvent("http://localhost:3000/admin", { cookie: COOKIE });

    const res = await run(protectedHandle(), event, resolve);

    expect(res.status).toBe(302);
  });

  it("keeps an anonymous session's cookie, since its sign-in may still complete", async () => {
    sessionsMe(Response.json({ session_id: "s1" }));
    const { event, resolve } = makeEvent("http://localhost:3000/admin", { cookie: COOKIE });

    const res = await run(protectedHandle(), event, resolve);

    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("clears a dead session cookie on a public page", async () => {
    sessionsMe(Response.json({ code: "auth.unauthorized", message: "gone" }, { status: 401 }));
    const { event, resolve } = makeEvent("http://localhost:3000/", { cookie: COOKIE });
    const deleteCookie = vi.spyOn(event.cookies, "delete");

    await run(protectedHandle(), event, resolve);

    expect(deleteCookie).toHaveBeenCalledWith("__nextgen_session", { path: "/" });
  });

  it.each(DEAD)("clears the cookie and redirects on a protected route for %s", async (_l, res) => {
    sessionsMe(res());
    const { event, resolve } = makeEvent("http://localhost:3000/admin", { cookie: COOKIE });

    const response = await run(protectedHandle(), event, resolve);

    expect([response.status, response.headers.getSetCookie()]).toEqual([
      302,
      ["__nextgen_session=; Path=/; Max-Age=0"],
    ]);
  });

  // A backend outage is not a sign-out: the cookie must survive it.
  it.each(OUTAGES)("keeps the cookie on a public page for %s", async (_l, fail) => {
    vi.stubGlobal("fetch", vi.fn(fail));
    const { event, resolve } = makeEvent("http://localhost:3000/", { cookie: COOKIE });
    const deleteCookie = vi.spyOn(event.cookies, "delete");

    const response = await run(protectedHandle(), event, resolve);

    expect([response.status, deleteCookie.mock.calls, event.locals.nextgenAuth]).toEqual([
      200,
      [],
      { isAuthenticated: false, session: null, reason: "unavailable" },
    ]);
  });

  it.each(OUTAGES)("answers a protected route 503 for %s", async (_l, fail) => {
    vi.stubGlobal("fetch", vi.fn(fail));
    const { event, resolve } = makeEvent("http://localhost:3000/admin", { cookie: COOKIE });

    const response = await run(protectedHandle(), event, resolve);

    expect([
      response.status,
      response.headers.get("location"),
      response.headers.getSetCookie(),
    ]).toEqual([503, null, []]);
  });

  // SvelteKit percent-decodes cookies: `x%0Ay` reaches the hook as a newline,
  // which must neither reach the backend nor read as an outage.
  it("clears a malformed session cookie on a protected route without asking the backend", async () => {
    const fetchMock = vi.fn(async () => Response.json({ session_id: "s1", user_id: "u1" }));
    vi.stubGlobal("fetch", fetchMock);
    const { event, resolve } = makeEvent("http://localhost:3000/admin", { cookie: COOKIE });
    event.cookies.set("__nextgen_session", "x\ny", { path: "/" });

    const response = await run(protectedHandle(), event, resolve);

    expect([response.status, response.headers.getSetCookie(), fetchMock.mock.calls]).toEqual([
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
    for (const value of ["x\ny", "poison"]) {
      const attacker = makeEvent("http://localhost:3000/admin", { cookie: COOKIE });
      attacker.event.cookies.set("__nextgen_session", value, { path: "/" });
      await run(protectedHandle(), attacker.event, attacker.resolve);
    }
    const { event, resolve } = makeEvent("http://localhost:3000/admin", { cookie: COOKIE });

    await run(protectedHandle(), event, resolve);

    expect(event.locals.nextgenAuth).toMatchObject({ isAuthenticated: true });
  });
});

// A JWKS that cannot be fetched on a cold cache says nothing about a JWT.
describe("JWT session during a JWKS outage", () => {
  function jwtCookie(): string {
    const token = makeJwt({ sub: "u1", iss: "http://localhost:4000", exp: ts(3600) }, nextKid());
    return `__nextgen_session=${token}`;
  }

  function protectedHandle() {
    return createNextgenHandle({ url: "http://localhost:4000", protectedRoutes: ["/admin"] });
  }

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("answers a protected route 503 and keeps the cookie", async () => {
    const { event, resolve } = makeEvent("http://localhost:3000/admin", { cookie: jwtCookie() });

    const response = await run(protectedHandle(), event, resolve);

    expect([response.status, response.headers.getSetCookie()]).toEqual([503, []]);
  });

  it("renders a public route as unavailable, keeping the cookie", async () => {
    const { event, resolve } = makeEvent("http://localhost:3000/", { cookie: jwtCookie() });
    const deleteCookie = vi.spyOn(event.cookies, "delete");

    await run(protectedHandle(), event, resolve);

    expect([deleteCookie.mock.calls, event.locals.nextgenAuth]).toEqual([
      [],
      { isAuthenticated: false, session: null, reason: "unavailable" },
    ]);
  });
});

describe("getClientAuth", () => {
  it("drops the session token, which load data would carry to the browser", () => {
    const { event } = makeEvent("http://localhost:3000/");
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
    const handle = createNextgenHandle({ url: "http://localhost:4000" });
    const { event, resolve } = makeEvent("http://localhost:3000/__nextgen/v1/flow");

    const response = await run(handle, event, resolve);

    expect([response.status, await response.json()]).toEqual([
      status,
      { code, message: expect.any(String) },
    ]);
  });
});
