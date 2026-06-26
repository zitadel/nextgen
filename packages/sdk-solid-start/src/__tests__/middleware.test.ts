/**
 * Contract tests for the SolidStart `onRequest` handler produced by
 * {@link createNextgenMiddleware}. Each test builds a minimal `FetchEvent` — a
 * web-standard `Request`, a `locals` bag, and an optional `clientAddress` — and
 * invokes `config.onRequest[0](event)`. The handler returns a `Response` to
 * short-circuit (proxy / redirect) or `undefined` to continue, mirroring the
 * sdk-nuxt middleware contract.
 */

import { generateKeyPairSync, createSign } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { SolidFetchEvent } from "../middleware";

import { createNextgenMiddleware } from "../middleware";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyJwk = publicKey.export({ type: "spki", format: "jwk" }) as Record<string, unknown>;

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
  if (opts.cookie) headers["cookie"] = opts.cookie;
  if (opts.authorization) headers["authorization"] = opts.authorization;
  return {
    request: new Request(url, { method: opts.method ?? "GET", headers }),
    locals: {},
    clientAddress: opts.clientAddress,
  };
}

function onRequest(
  config: ReturnType<typeof createNextgenMiddleware>,
  event: SolidFetchEvent,
): Promise<Response | void> {
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
      session: { userId: "user-ss", email: "ss@example.com", name: null, token },
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
    it("throws on an absolute loginPath", () => {
      expect(() =>
        createNextgenMiddleware({ url: "http://localhost:4000", loginPath: "https://evil.test/x" }),
      ).toThrow(/loginPath must be a relative path/i);
    });

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

    it("forwards upstream Set-Cookie and strips location", async () => {
      const upstreamHeaders = new Headers();
      upstreamHeaders.append("set-cookie", "__nextgen_session=abc; HttpOnly");
      upstreamHeaders.set("location", "http://internal:4000/cb");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("{}", { status: 200, headers: upstreamHeaders })),
      );

      const mw = createNextgenMiddleware({ url: "http://localhost:4000" });
      const res = await onRequest(mw, makeEvent("http://localhost:3000/__nextgen/v1/flow"));

      expect(res?.headers.get("set-cookie")).toContain("__nextgen_session=abc");
      expect(res?.headers.get("location")).toBeNull();
    });

    it("attaches the project secret as the bearer", async () => {
      let captured: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          captured = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );

      const mw = createNextgenMiddleware({ url: "http://localhost:4000", projectSecret: "sk-1" });
      await onRequest(mw, makeEvent("http://localhost:3000/__nextgen/v1/flow"));
      expect(captured?.get("authorization")).toBe("Bearer sk-1");
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
});
