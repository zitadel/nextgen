/**
 * Contract tests for the Qwik City `onRequest` handler produced by
 * {@link createNextgenOnRequest}. Each test builds a minimal
 * `RequestEventCommon` — a web-standard `Request`, a `sharedMap`, a cookie jar,
 * `clientConn`, and `send`/`redirect` spies — and invokes the handler. The
 * handler ends the chain by calling `ev.send(response)` (proxy) or throwing
 * `ev.redirect(...)` (protected route), mirroring the sdk-nuxt middleware
 * contract.
 */

import { generateKeyPairSync, createSign } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { QwikRequestEvent } from "../request-handler";

import { createNextgenOnRequest, getAuth } from "../request-handler";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyJwk = publicKey.export({ type: "spki", format: "jwk" }) as Record<string, unknown>;

let kidCounter = 0;
function nextKid(): string {
  return `qwikcity-test-key-${++kidCounter}`;
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

class RedirectMarker {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {}
}

interface Harness {
  readonly ev: QwikRequestEvent;
  readonly deleted: string[];
  sent?: Response;
  redirected?: { status: number; url: string };
}

function makeHarness(url: string, opts: MakeEventOptions = {}): Harness {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.cookie) headers["cookie"] = opts.cookie;
  if (opts.authorization) headers["authorization"] = opts.authorization;

  const jar = new Map<string, string>();
  if (opts.cookie) {
    for (const part of opts.cookie.split(";")) {
      const idx = part.indexOf("=");
      if (idx === -1) continue;
      jar.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
    }
  }

  const harness: Harness = { deleted: [] } as unknown as Harness;
  const ev: QwikRequestEvent = {
    request: new Request(url, { method: opts.method ?? "GET", headers }),
    url: new URL(url),
    sharedMap: new Map<string, unknown>(),
    clientConn: { ip: opts.clientIp },
    cookie: {
      get: (name) => (jar.has(name) ? { value: jar.get(name)! } : null),
      getAll: () => Object.fromEntries([...jar.entries()].map(([n, v]) => [n, { value: v }])),
      delete: (name) => {
        harness.deleted.push(name);
        jar.delete(name);
      },
    },
    send: (response) => {
      harness.sent = response;
    },
    redirect: (status, u) => {
      harness.redirected = { status, url: u };
      return new RedirectMarker(status, u);
    },
  };
  (harness as { ev: QwikRequestEvent }).ev = ev;
  return harness;
}

/** Runs the handler, swallowing a thrown {@link RedirectMarker}. */
async function run(
  handler: (ev: QwikRequestEvent) => Promise<void>,
  ev: QwikRequestEvent,
): Promise<void> {
  try {
    await handler(ev);
  } catch (err) {
    if (!(err instanceof RedirectMarker)) throw err;
  }
}

function ts(offsetSeconds: number): number {
  return Math.floor(Date.now() / 1000) + offsetSeconds;
}

describe("createNextgenOnRequest (Qwik City)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("public route with no token sets sharedMap to unauthenticated", async () => {
    const handler = createNextgenOnRequest({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });
    const h = makeHarness("http://localhost:3000/");

    await run(handler, h.ev);

    expect(h.redirected).toBeUndefined();
    expect(h.sent).toBeUndefined();
    expect(getAuth(h.ev)).toEqual({ isAuthenticated: false, session: null });
  });

  it("protected route with no token redirects to /login?next=/admin", async () => {
    const handler = createNextgenOnRequest({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });
    const h = makeHarness("http://localhost:3000/admin");

    await run(handler, h.ev);

    expect(h.redirected?.status).toBe(302);
    expect(h.redirected?.url).toContain("/login");
    expect(h.redirected?.url).toContain("next=%2Fadmin");
  });

  it("protected route with a valid cookie token sets sharedMap to authenticated", async () => {
    const kid = nextKid();
    const token = makeJwt(
      { sub: "user-qc", email: "qc@example.com", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
    );
    vi.stubGlobal("fetch", mockJwks(kid));

    const handler = createNextgenOnRequest({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });
    const h = makeHarness("http://localhost:3000/admin", { cookie: `__nextgen_session=${token}` });

    await run(handler, h.ev);

    expect(h.redirected).toBeUndefined();
    expect(getAuth(h.ev)).toEqual({
      isAuthenticated: true,
      session: { userId: "user-qc", email: "qc@example.com", name: null, token },
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

    const handler = createNextgenOnRequest({ url: "http://localhost:4000", protectedRoutes: [] });
    const h = makeHarness("http://localhost:3000/", {
      cookie: `__nextgen_session=${cookieToken}`,
      authorization: `Bearer ${bearerToken}`,
    });

    await run(handler, h.ev);
    const auth = getAuth(h.ev);
    expect(auth.isAuthenticated && auth.session.token).toBe(bearerToken);
  });

  it("token with no sub redirects on a protected route", async () => {
    const kid = nextKid();
    const token = makeJwt(
      { email: "qc@example.com", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
    );
    vi.stubGlobal("fetch", mockJwks(kid));

    const handler = createNextgenOnRequest({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });
    const h = makeHarness("http://localhost:3000/admin", { cookie: `__nextgen_session=${token}` });

    await run(handler, h.ev);
    expect(h.redirected?.status).toBe(302);
    expect(getAuth(h.ev)).toEqual({ isAuthenticated: false, session: null });
  });

  it("rejects a disallowed typ on a protected route", async () => {
    const kid = nextKid();
    const token = makeJwt(
      { sub: "user-qc", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
      "refresh_token",
    );
    vi.stubGlobal("fetch", mockJwks(kid));

    const handler = createNextgenOnRequest({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      allowedTokenTypes: ["JWT", "at+JWT"],
    });
    const h = makeHarness("http://localhost:3000/admin", { cookie: `__nextgen_session=${token}` });

    await run(handler, h.ev);
    expect(h.redirected?.status).toBe(302);
  });

  it('rejects alg "none" without fetching JWKS', async () => {
    const kid = nextKid();
    const token = makeJwt(
      { sub: "user-qc", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
      "JWT",
      "none",
    );
    vi.stubGlobal("fetch", vi.fn());

    const handler = createNextgenOnRequest({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });
    const h = makeHarness("http://localhost:3000/admin", { cookie: `__nextgen_session=${token}` });

    await run(handler, h.ev);
    expect(h.redirected?.status).toBe(302);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("clears the stale session cookie and redirects when the token is invalid", async () => {
    const kid = nextKid();
    const valid = makeJwt({ sub: "user-qc", iss: "http://localhost:4000", exp: ts(3600) }, kid);
    const parts = valid.split(".");
    const tampered = `${parts[0]}.${parts[1]}.invalidsig`;
    vi.stubGlobal("fetch", mockJwks(kid));

    const handler = createNextgenOnRequest({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });
    const h = makeHarness("http://localhost:3000/admin", {
      cookie: `__nextgen_session=${tampered}`,
    });

    await run(handler, h.ev);
    expect(h.redirected?.status).toBe(302);
    expect(h.deleted).toContain("__nextgen_session");
  });

  describe("loginPath validation", () => {
    it("throws on an absolute loginPath", () => {
      expect(() =>
        createNextgenOnRequest({ url: "http://localhost:4000", loginPath: "https://evil.test/x" }),
      ).toThrow(/loginPath must be a relative path/i);
    });

    it("throws on a protocol-relative loginPath", () => {
      expect(() =>
        createNextgenOnRequest({ url: "http://localhost:4000", loginPath: "//evil.test/x" }),
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

      const handler = createNextgenOnRequest({ url: "http://localhost:4000" });
      const h = makeHarness("http://localhost:3000/__nextgen/v1/flow", {
        headers: { "x-nextgen-auth-token": "secret", "content-type": "application/json" },
      });

      await run(handler, h.ev);
      expect(captured?.has("x-nextgen-auth-token")).toBe(false);
      expect(captured?.get("content-type")).toBe("application/json");
    });

    it("sends the upstream response with Set-Cookie forwarded and location stripped", async () => {
      const upstreamHeaders = new Headers();
      upstreamHeaders.append("set-cookie", "__nextgen_session=abc; HttpOnly");
      upstreamHeaders.set("location", "http://internal:4000/cb");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("{}", { status: 200, headers: upstreamHeaders })),
      );

      const handler = createNextgenOnRequest({ url: "http://localhost:4000" });
      const h = makeHarness("http://localhost:3000/__nextgen/v1/flow");

      await run(handler, h.ev);
      expect(h.sent?.headers.get("set-cookie")).toContain("__nextgen_session=abc");
      expect(h.sent?.headers.get("location")).toBeNull();
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

      const handler = createNextgenOnRequest({
        url: "http://localhost:4000",
        projectSecret: "sk-1",
      });
      const h = makeHarness("http://localhost:3000/__nextgen/v1/flow");

      await run(handler, h.ev);
      expect(captured?.get("authorization")).toBe("Bearer sk-1");
    });

    it("appends the client IP to the X-Forwarded-For chain", async () => {
      let captured: Headers | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          captured = init.headers as Headers;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }),
      );

      const handler = createNextgenOnRequest({ url: "http://localhost:4000" });
      const h = makeHarness("http://localhost:3000/__nextgen/v1/flow", {
        headers: { "x-forwarded-for": "10.0.0.1" },
        clientIp: "10.0.0.2",
      });

      await run(handler, h.ev);
      const xff = captured?.get("x-forwarded-for") ?? "";
      expect(xff).toContain("10.0.0.1");
      expect(xff).toContain("10.0.0.2");
    });

    it("does not proxy a path that only shares the prefix without a separator", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

      const handler = createNextgenOnRequest({ url: "http://localhost:4000" });
      const h = makeHarness("http://localhost:3000/__nextgen-evil/resource");

      await run(handler, h.ev);
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
      expect(h.sent).toBeUndefined();
    });
  });

  describe("ignored routes", () => {
    it("skips auth handling on an ignored route", async () => {
      const handler = createNextgenOnRequest({
        url: "http://localhost:4000",
        protectedRoutes: ["/health"],
        ignoredRoutes: ["/health"],
      });
      const h = makeHarness("http://localhost:3000/health");

      await run(handler, h.ev);
      expect(h.redirected).toBeUndefined();
      expect(h.ev.sharedMap.has("nextgenAuth")).toBe(false);
    });
  });
});
