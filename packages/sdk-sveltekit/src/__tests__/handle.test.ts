/**
 * Contract tests for the SvelteKit `handle` hook produced by
 * {@link createNextgenHandle}. SvelteKit ships no lightweight in-process test
 * harness (unlike h3's `createApp`), so each test constructs a minimal
 * `RequestEvent` — a URL, a web-standard `Request`, an in-memory cookie jar,
 * `locals`, and `getClientAddress()` — plus a `resolve` spy, exactly the surface
 * the hook touches. The assertions mirror the sdk-nuxt middleware contract.
 */

import type { Handle, RequestEvent } from "@sveltejs/kit";

import { generateKeyPairSync, createSign } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { createNextgenHandle } from "../handle";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyJwk = publicKey.export({ type: "spki", format: "jwk" }) as Record<string, unknown>;

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
  if (opts.cookie) headers["cookie"] = opts.cookie;
  if (opts.authorization) headers["authorization"] = opts.authorization;

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
      session: { userId: "user-sk", email: "sk@example.com", name: null, token },
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

    it("strips the location header from the upstream response", async () => {
      const upstreamHeaders = new Headers();
      upstreamHeaders.set("content-type", "application/json");
      upstreamHeaders.set("location", "http://internal-auth.corp:4000/callback");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("{}", { status: 302, headers: upstreamHeaders })),
      );

      const handle = createNextgenHandle({ url: "http://localhost:4000" });
      const { event, resolve } = makeEvent("http://localhost:3000/__nextgen/v1/flow");

      const res = await run(handle, event, resolve);
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("content-type")).toBe("application/json");
    });

    it("attaches the project secret as the bearer when none is present", async () => {
      let capturedHeaders: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          capturedHeaders = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );

      const handle = createNextgenHandle({ url: "http://localhost:4000", projectSecret: "sk-123" });
      const { event, resolve } = makeEvent("http://localhost:3000/__nextgen/v1/flow");

      await run(handle, event, resolve);
      expect(capturedHeaders?.get("authorization")).toBe("Bearer sk-123");
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
