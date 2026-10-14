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
import type { RequestEvent, RequestHandler } from "@qwik.dev/router";
import { describe, it, expect, expectTypeOf, vi, afterEach, beforeEach } from "vitest";

import type { QwikRequestEvent } from "../request-handler";

import { createNextgenOnRequest, getAuth } from "../request-handler";
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
  /** What Qwik's `ev.env` holds — where Vite loads `.env.local`. */
  readonly env?: Record<string, string>;
}

class RedirectMarker {
  readonly status: number;
  readonly url: string;
  constructor(status: number, url: string) {
    this.status = status;
    this.url = url;
  }
}

interface Harness {
  readonly ev: QwikRequestEvent;
  readonly deleted: string[];
  sent?: Response;
  redirected?: { status: number; url: string };
}

function makeHarness(url: string, opts: MakeEventOptions = {}): Harness {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.authorization) headers.authorization = opts.authorization;

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
    ...(opts.env ? { env: { get: (key: string) => opts.env?.[key] } } : {}),
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

  // Qwik Router defaults to `trailingSlash: true`, so `/profile/` is the
  // canonical URL and must not slip past `protectedRoutes: ["/profile"]`.
  it("protected route requested with a trailing slash redirects to login", async () => {
    const handler = createNextgenOnRequest({
      url: "http://localhost:4000",
      protectedRoutes: ["/profile"],
      loginPath: "/login",
    });
    const h = makeHarness("http://localhost:3000/profile/");

    await run(handler, h.ev);

    expect(h.redirected?.url).toContain("/login");
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
      session: {
        userId: "user-qc",
        identifier: "qc@example.com",
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
    // A visitor without a session would be redirected from /login to /login forever.
    it("throws at setup when protectedRoutes match the loginPath", () => {
      expect(() =>
        createNextgenOnRequest({
          url: "http://localhost:4000",
          loginPath: "/login",
          protectedRoutes: ["/*"],
        }),
      ).toThrow(/is matched by protectedRoutes/);
    });

    it("accepts a loginPath that ignoredRoutes exempt from protectedRoutes", () => {
      expect(() =>
        createNextgenOnRequest({
          url: "http://localhost:4000",
          loginPath: "/login",
          protectedRoutes: ["/*"],
          ignoredRoutes: ["/login"],
        }),
      ).not.toThrow();
    });

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

    it("sends the upstream response with Set-Cookie forwarded", async () => {
      const upstreamHeaders = new Headers();
      upstreamHeaders.append("set-cookie", "__nextgen_session=abc; HttpOnly");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("{}", { status: 200, headers: upstreamHeaders })),
      );

      const handler = createNextgenOnRequest({ url: "http://localhost:4000" });
      const h = makeHarness("http://localhost:3000/__nextgen/v1/flow");

      await run(handler, h.ev);
      expect(h.sent?.headers.get("set-cookie")).toContain("__nextgen_session=abc");
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

      const handler = createNextgenOnRequest({ url: "http://localhost:4000" });
      const h = makeHarness("http://localhost:3000/__nextgen/idp/callback?code=x");

      await run(handler, h.ev);
      expect(h.sent?.headers.get("location")).toBe(expected);
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

      const handler = createNextgenOnRequest({
        url: "http://localhost:4000",
        projectSecret: "sk-1",
      });
      const h = makeHarness("http://localhost:3000/__nextgen/sessions/exchange", {
        method: "POST",
      });

      await run(handler, h.ev);
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

      const handler = createNextgenOnRequest({
        url: "http://localhost:4000",
        projectSecret: "sk-1",
      });
      const h = makeHarness(`http://localhost:3000${path}`, { method });

      await run(handler, h.ev);
      expect(captured()?.has("authorization")).toBe(false);
    });

    it("keeps a caller-supplied credential on the handoff exchange", async () => {
      const captured = captureUpstreamHeaders();

      const handler = createNextgenOnRequest({
        url: "http://localhost:4000",
        projectSecret: "sk-1",
      });
      const h = makeHarness("http://localhost:3000/__nextgen/sessions/exchange", {
        method: "POST",
        authorization: "Bearer pk-caller",
      });

      await run(handler, h.ev);
      expect(captured()?.get("authorization")).toBe("Bearer pk-caller");
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

  // The generated `plugin@nextgen.ts` exports the handler as Qwik Router's
  // `onRequest`, so Qwik's real `RequestEvent` must satisfy the structural
  // `QwikRequestEvent` the handler reads. Checked by `tsc -p tsconfig.spec.json`.
  describe("Qwik Router 2 compatibility", () => {
    it("accepts Qwik Router's RequestEvent as a QwikRequestEvent", () => {
      expectTypeOf<RequestEvent>().toExtend<QwikRequestEvent>();
    });

    it("is assignable as a Qwik Router onRequest handler", () => {
      expectTypeOf(
        createNextgenOnRequest({ url: "http://localhost:4000" }),
      ).toExtend<RequestHandler>();
    });
  });
});

// The backend issues opaque session tokens; the handler asks /sessions/me.
describe("opaque session cookie", () => {
  const COOKIE = "__nextgen_session=opaque-session-token";

  function sessionsMe(response: Response): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
  }

  function protectedHandler() {
    return createNextgenOnRequest({
      url: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });
  }

  it("signs in a live session that names a user, with the user's details", async () => {
    sessionsMe(
      Response.json({
        user_id: "u1",
        user: { identifier: "ada@example.com", identifier_property: "email", display: "Ada" },
      }),
    );
    const h = makeHarness("http://localhost:3000/admin", { cookie: COOKIE });

    await run(protectedHandler(), h.ev);

    expect(getAuth(h.ev)).toMatchObject({
      isAuthenticated: true,
      session: { userId: "u1", identifier: "ada@example.com", display: "Ada" },
    });
  });

  // CreateSession sets the cookie before any factor is verified: an abandoned
  // sign-in must not open protected routes.
  it("redirects an anonymous session on a protected route to login", async () => {
    sessionsMe(Response.json({}));
    const h = makeHarness("http://localhost:3000/admin", { cookie: COOKIE });

    await run(protectedHandler(), h.ev);

    expect(h.redirected?.url).toContain("/login");
  });

  it("keeps an anonymous session's cookie, since its sign-in may still complete", async () => {
    sessionsMe(Response.json({}));
    const h = makeHarness("http://localhost:3000/admin", { cookie: COOKIE });

    await run(protectedHandler(), h.ev);

    expect(h.deleted).toEqual([]);
  });

  it("clears a dead session cookie on a public page", async () => {
    sessionsMe(Response.json({ code: "auth.unauthorized", message: "gone" }, { status: 401 }));
    const h = makeHarness("http://localhost:3000/", { cookie: COOKIE });

    await run(protectedHandler(), h.ev);

    expect(h.deleted).toEqual(["__nextgen_session"]);
  });

  it.each(DEAD)("clears the cookie and redirects on a protected route for %s", async (_l, res) => {
    sessionsMe(res());
    const h = makeHarness("http://localhost:3000/admin", { cookie: COOKIE });

    await run(protectedHandler(), h.ev);

    expect([h.redirected?.status, h.deleted]).toEqual([302, ["__nextgen_session"]]);
  });

  // A backend outage is not a sign-out: the cookie must survive it.
  it.each(OUTAGES)("keeps the cookie on a public page for %s", async (_l, fail) => {
    vi.stubGlobal("fetch", vi.fn(fail));
    const h = makeHarness("http://localhost:3000/", { cookie: COOKIE });

    await run(protectedHandler(), h.ev);

    expect([h.sent, h.redirected, h.deleted, getAuth(h.ev)]).toEqual([
      undefined,
      undefined,
      [],
      { isAuthenticated: false, session: null, reason: "unavailable" },
    ]);
  });

  it.each(OUTAGES)("answers a protected route 503 for %s", async (_l, fail) => {
    vi.stubGlobal("fetch", vi.fn(fail));
    const h = makeHarness("http://localhost:3000/admin", { cookie: COOKIE });

    await run(protectedHandler(), h.ev);

    expect([h.sent?.status, h.redirected, h.deleted]).toEqual([503, undefined, []]);
  });
});

describe("proxy upstream failure", () => {
  it.each(PROXY_FAILURES)("answers %s with %i", async (_l, status, code, fail) => {
    vi.stubGlobal("fetch", vi.fn(fail));
    const h = makeHarness("http://localhost:3000/__nextgen/v1/flow");

    await run(createNextgenOnRequest({ url: "http://localhost:4000" }), h.ev);

    expect([h.sent?.status, await h.sent?.json()]).toEqual([
      status,
      { code, message: expect.any(String) },
    ]);
  });
});

describe("inbound x-nextgen-auth-token", () => {
  it.each([
    ["a public route", "http://localhost:3000/"],
    ["an ignored route", "http://localhost:3000/health"],
  ])("is stripped on %s", async (_l, url) => {
    const h = makeHarness(url, { headers: { "x-nextgen-auth-token": "forged" } });

    await run(createNextgenOnRequest({ ignoredRoutes: ["/health"] }), h.ev);

    expect(h.ev.request.headers.has("x-nextgen-auth-token")).toBe(false);
  });
});

// Vite loads `.env.local` into Qwik's `ev.env`, not `process.env`, so the
// handler resolves its settings per request: option > ev.env > process.env.
describe("configuration from ev.env", () => {
  const EXCHANGE = "http://localhost:3000/__nextgen/sessions/exchange";

  function upstream(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function sentTo(fetchMock: ReturnType<typeof vi.fn>): [string, string | null] {
    const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return [target, new Headers(init.headers).get("authorization")];
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    [
      "env only",
      {},
      { ZITADEL_URL: "http://env.test", ZITADEL_PROJECT_SECRET: "sk_env" },
      {},
      ["http://env.test/sessions/exchange", "Bearer sk_env"],
    ],
    [
      "an option over env",
      { url: "http://option.test", projectSecret: "sk_option" },
      { ZITADEL_URL: "http://env.test", ZITADEL_PROJECT_SECRET: "sk_env" },
      {},
      ["http://option.test/sessions/exchange", "Bearer sk_option"],
    ],
    [
      "env over process.env",
      {},
      { ZITADEL_URL: "http://env.test", ZITADEL_PROJECT_SECRET: "sk_env" },
      { ZITADEL_URL: "http://process.test", ZITADEL_PROJECT_SECRET: "sk_process" },
      ["http://env.test/sessions/exchange", "Bearer sk_env"],
    ],
    [
      "process.env without env",
      {},
      {},
      { ZITADEL_URL: "http://process.test", ZITADEL_PROJECT_SECRET: "sk_process" },
      ["http://process.test/sessions/exchange", "Bearer sk_process"],
    ],
  ])("resolves the backend and secret from %s", async (_l, options, env, processEnv, expected) => {
    for (const [key, value] of Object.entries(processEnv)) vi.stubEnv(key, value);
    const fetchMock = upstream();
    const h = makeHarness(EXCHANGE, { method: "POST", env });

    await run(createNextgenOnRequest(options), h.ev);

    expect(sentTo(fetchMock)).toEqual(expected);
  });
});
