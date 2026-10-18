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
import { afterEach, describe, it, expect, expectTypeOf, vi, beforeEach } from "vitest";

import type { QwikRequestEvent } from "../request-handler";

import { createNextgenOnRequest, getAuth } from "../request-handler";
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
    sessionsMe(new Response(null, { status: 401 }));
    const h = makeHarness("http://localhost:3000/", { cookie: COOKIE });

    await run(protectedHandler(), h.ev);

    expect(h.deleted).toEqual(["__nextgen_session"]);
  });
});

// The cases below run under the same titles in every server SDK (sdk-next,
// sdk-nuxt, sdk-sveltekit, sdk-solid-start, sdk-qwik-city, sdk-tanstack-start).
// Only `serve` differs: it drives this SDK's handler with one request and
// reports the proxied response (undefined when the request was not proxied).
type ServeOptions = NonNullable<Parameters<typeof createNextgenOnRequest>[0]>;
interface ServeInit {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly authorization?: string;
}

async function serve(
  url: string,
  init: ServeInit = {},
  options: ServeOptions = {},
): Promise<{ response?: Response; request: Request }> {
  const h = makeHarness(url, init);
  await run(createNextgenOnRequest(options), h.ev);
  return { response: h.sent, request: h.ev.request };
}

function captureFetch(response: () => Response = () => new Response("{}", { status: 200 })) {
  const calls: { url: string; headers: Headers }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, init: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers) });
      return Promise.resolve(response());
    }),
  );
  return calls;
}

describe("shared server SDK cases", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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
      const calls = captureFetch();

      await serve(`http://localhost:3000${pathname}`, { method }, { url: "http://localhost:4000" });

      expect(calls[0]?.headers.has("authorization")).toBe(false);
    });

    it("attaches the project secret only to POST /sessions/exchange, ignoring the query", async () => {
      vi.stubEnv("ZITADEL_PROJECT_SECRET", "project-secret");
      const calls = captureFetch();

      await serve(
        "http://localhost:3000/__nextgen/sessions/exchange?source=browser",
        { method: "POST" },
        { url: "http://localhost:4000" },
      );

      expect(calls[0]?.headers.get("authorization")).toBe("Bearer project-secret");
    });

    it("preserves the upstream session cache policy", async () => {
      captureFetch(
        () =>
          new Response("{}", { status: 200, headers: { "cache-control": "private, no-store" } }),
      );

      const { response } = await serve(
        "http://localhost:3000/__nextgen/sessions/me",
        {},
        { url: "http://localhost:4000" },
      );

      expect(response?.headers.get("cache-control")).toBe("private, no-store");
    });
  });

  describe("proxy: Location header rewriting (S-1)", () => {
    it("keeps the path but never the internal host of an upstream redirect", async () => {
      captureFetch(
        () =>
          new Response("{}", {
            status: 302,
            headers: {
              "content-type": "application/json",
              location: "http://internal-auth.corp:4000/callback",
            },
          }),
      );

      const { response } = await serve(
        "http://localhost:3000/__nextgen/v1/flow",
        {},
        { url: "http://localhost:4000" },
      );

      // Only the path is taken, so the upstream's own host never reaches the browser.
      expect(response?.headers.get("location")).toBe("http://localhost:3000/callback");
      expect(response?.headers.get("location")).not.toContain("internal-auth.corp");
      expect(response?.headers.get("content-type")).toBe("application/json");
    });
  });

  describe("proxy: path-separator guard (W-2)", () => {
    it("proxies an exact match of proxyPath", async () => {
      const calls = captureFetch();

      const { response } = await serve(
        "http://localhost:3000/__nextgen",
        {},
        { url: "http://localhost:4000" },
      );

      expect(calls).toHaveLength(1);
      expect(response?.status).toBe(200);
    });

    it("proxies paths under proxyPath", async () => {
      const calls = captureFetch();

      const { response } = await serve(
        "http://localhost:3000/__nextgen/v1/flow",
        {},
        { url: "http://localhost:4000" },
      );

      expect(calls).toHaveLength(1);
      expect(response?.status).toBe(200);
    });
  });

  describe("inbound x-nextgen-auth-token", () => {
    it.each([
      ["a public route", "http://localhost:3000/"],
      ["an ignored route", "http://localhost:3000/health"],
    ])("is stripped on %s", async (_l, url) => {
      const { request } = await serve(
        url,
        { headers: { "x-nextgen-auth-token": "forged" } },
        { ignoredRoutes: ["/health"] },
      );

      expect(request.headers.has("x-nextgen-auth-token")).toBe(false);
    });

    it("refuses the request when the header cannot be removed", async () => {
      const h = makeHarness("http://localhost:3000/", {
        headers: { "x-nextgen-auth-token": "forged" },
      });
      h.ev.request.headers.delete = () => {
        throw new TypeError("immutable");
      };

      await run(createNextgenOnRequest(), h.ev);

      expect(h.sent?.status).toBe(400);
    });

    it("lets the request through when removal fails but the header is absent", async () => {
      const h = makeHarness("http://localhost:3000/");
      h.ev.request.headers.delete = () => {
        throw new TypeError("immutable");
      };

      await run(createNextgenOnRequest(), h.ev);

      expect(h.sent).toBeUndefined();
    });
  });

  // An app that reads its secret from a secrets manager at runtime passes it in.
  describe("project secret sources", () => {
    it.each([
      ["the option", "sk_option", "sk_env", "Bearer sk_option"],
      ["ZITADEL_PROJECT_SECRET", undefined, "sk_env", "Bearer sk_env"],
      ["nothing", undefined, undefined, null],
    ])("sends the exchange bearer from %s", async (_l, option, env, expected) => {
      vi.stubEnv("ZITADEL_PROJECT_SECRET", env);
      const calls = captureFetch(() => Response.json({ session_id: "s1" }));

      await serve(
        "http://localhost:3000/__nextgen/sessions/exchange",
        { method: "POST" },
        { url: "http://localhost:4000", projectSecret: option },
      );

      expect(calls[0]?.headers.get("authorization")).toBe(expected);
    });
  });

  describe("backend URL sources", () => {
    it.each([
      ["the option", "http://option.test:4000", "http://env.test:4000", "http://option.test:4000/"],
      ["ZITADEL_URL", undefined, "http://env.test:4000", "http://env.test:4000/"],
    ])("proxies to the backend from %s", async (_l, option, env, expected) => {
      vi.stubEnv("ZITADEL_URL", env);
      const calls = captureFetch();

      await serve("http://localhost:3000/__nextgen/v1/flow", {}, { url: option });

      expect(calls[0]?.url.startsWith(expected)).toBe(true);
    });
  });
});
