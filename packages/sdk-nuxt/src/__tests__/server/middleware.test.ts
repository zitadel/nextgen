/**
 * Server middleware contract for Nuxt. The cases below are identical in every
 * server SDK; only the glue between `serve` and this SDK's handler differs.
 */

import type { EventHandler, H3Event, H3EventContext } from "h3";

import { createApp, toWebHandler } from "h3";
import { generateKeyPairSync, createSign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { AuthResult, NextgenMiddlewareOptions } from "@zitadel/sdk-core/middleware";

import { clearJwksCache } from "@zitadel/sdk-core/jwt";

import { createNextgenMiddleware, getAuth } from "../../runtime/server/middleware";
import { setRuntimeConfig } from "../stubs/nuxt-imports";

// The JWKS cache is module-level and per issuer: start every case from a cold
// cache, so each one fetches the keys its own mock publishes.
beforeEach(() => {
  clearJwksCache();
});

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyJwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let kidCounter = 0;
function nextKid(): string {
  return `server-test-key-${++kidCounter}`;
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

function ts(offsetSeconds: number): number {
  return Math.floor(Date.now() / 1000) + offsetSeconds;
}

/** The project the app under test signs its users in to. */
const PROJECT = "proj_app";

/**
 * Another project on the same server: a second app, or the console's own
 * project. On one host every port shares the cookie jar, so its session cookie
 * reaches this app too.
 */
const OTHER_PROJECT = "proj_other";

/** The cookie this app keeps its project's session in (ADR 073). */
const SESSION = `__nextgen_session_${PROJECT}`;

/**
 * The cookie the server sets, which every project on a host shared before
 * ADR 073, and where the Console of a local server still keeps its session.
 */
const SHARED = "__nextgen_session";

/** Publishes the test key as the JWKS and returns a signer for tokens it verifies. */
function signer() {
  const kid = nextKid();
  vi.stubGlobal("fetch", mockJwks(kid));
  return (claims: Record<string, unknown> = {}, typ = "JWT", alg = "RS256"): string =>
    makeJwt(
      {
        sub: "user-123",
        email: "user@example.com",
        iss: "http://localhost:4000",
        aud: PROJECT,
        exp: ts(3600),
        ...claims,
      },
      kid,
      typ,
      alg,
    );
}

/** Replaces `fetch` with a stub that records every upstream call. */
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

/** Answers the opaque-session lookup (`GET /sessions/me`) with `response`. */
function sessionsMe(response: Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response),
  );
}

/** Fails the opaque-session lookup on the network, as a backend that is down does. */
function sessionsMeUnreachable(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("fetch failed");
    }),
  );
}

/** Never answers the opaque-session lookup: it ends only when its signal aborts. */
function sessionsMeSilent(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    ),
  );
}

/**
 * Asserts that an answer moved this project's session `token` out of the shared
 * cookie: it sets the app's own cookie, HttpOnly, for the session's lifetime,
 * and clears the shared one.
 */
function expectMoved(headers: Headers, token: string): void {
  const setCookies = headers.getSetCookie();
  const moved = setCookies.find((cookie) => cookie.startsWith(`${SESSION}=`));
  const cleared = setCookies.find((cookie) => cookie.startsWith(`${SHARED}=`));
  expect(setCookies).toHaveLength(2);
  expect(moved).toMatch(new RegExp(`^${SESSION}=${token};`));
  expect(moved).toMatch(/; Path=\/(;|$)/i);
  expect(moved).toMatch(/; Max-Age=[1-9]\d*(;|$)/i);
  expect(moved).toMatch(/; HttpOnly(;|$)/i);
  expect(moved).toMatch(/; SameSite=Lax(;|$)/i);
  expect(cleared).toMatch(new RegExp(`^${SHARED}=;`));
  expect(cleared).toMatch(/Max-Age=0|expires=.*1970/i);
}

type ServeOptions = NextgenMiddlewareOptions & { projectSecret?: string };

interface ServeInit {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly clientIp?: string;
}

interface Served {
  /** The SDK ended the request itself (proxy, redirect or refusal). */
  readonly answered: boolean;
  readonly status: number;
  readonly headers: Headers;
  /** What a downstream handler reads as the session; undefined when none was set. */
  readonly auth: AuthResult | undefined;
  /** The request headers a downstream handler sees. */
  readonly inbound: Headers;
  /** The answer's body. */
  readonly body: string;
}

// ---- SDK glue: how a request reaches this SDK's handler and how the answer is read.

function resetSdk(): void {
  setRuntimeConfig({ nextgen: {} });
}

async function serve(
  url: string,
  init: ServeInit = {},
  options: ServeOptions = {},
): Promise<Served> {
  const app = createApp();
  if (init.clientIp) {
    app.use((event) => {
      (event.node.req as unknown as { socket: { remoteAddress?: string } }).socket = {
        remoteAddress: init.clientIp,
      };
    });
  }
  app.use(createNextgenMiddleware(options));
  let continued = false;
  let auth: AuthResult | undefined;
  let inbound = new Headers();
  app.use((event) => {
    continued = true;
    auth = event.context.nextgenAuth;
    inbound = new Headers(event.node.req.headers as Record<string, string>);
    return { ok: true };
  });
  const response = await toWebHandler(app)(
    new Request(url, {
      method: init.method ?? "GET",
      headers: { host: new URL(url).host, ...init.headers },
    }),
  );
  return {
    answered: !continued,
    status: response.status,
    headers: response.headers,
    auth,
    inbound,
    body: await response.text(),
  };
}

function configureSecret(configured?: string, environment?: string): ServeOptions {
  setRuntimeConfig({ nextgen: { projectSecret: configured ?? environment } });
  return {};
}

function configureProject(configured?: string, environment?: string): ServeOptions {
  vi.stubEnv("ZITADEL_PROJECT_ID", environment);
  vi.stubEnv("NUXT_PUBLIC_ZITADEL_PROJECT_ID", undefined);
  return { projectId: configured };
}

async function readAuth(context: unknown): Promise<AuthResult> {
  return getAuth({ context: context ?? {} } as unknown as H3Event);
}

function expectHandlerType(): void {
  expectTypeOf(createNextgenMiddleware({ url: "http://localhost:4000" })).toExtend<EventHandler>();
  expectTypeOf<H3EventContext["nextgenAuth"]>().toEqualTypeOf<AuthResult | undefined>();
}

const ORIGIN = "http://localhost:3000";
const OPTIONS: ServeOptions = {
  url: "http://localhost:4000",
  projectId: PROJECT,
  protectedRoutes: ["/admin"],
  loginPath: "/login",
};
const PROXY: ServeOptions = { url: "http://localhost:4000" };

describe("server middleware", () => {
  /** The proxy of an app that knows its project. */
  const APP_PROXY: ServeOptions = { ...PROXY, projectId: PROJECT };

  beforeEach(() => {
    vi.restoreAllMocks();
    resetSdk();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("public route with no token continues as unauthenticated", async () => {
    const served = await serve(`${ORIGIN}/`, {}, OPTIONS);

    expect(served.answered).toBe(false);
    expect(served.auth?.isAuthenticated).toBe(false);
  });

  it("protected route with no token redirects to /login?next=/admin", async () => {
    const served = await serve(`${ORIGIN}/admin`, {}, OPTIONS);

    expect(served.status).toBe(302);
    expect(served.headers.get("location")).toContain("/login");
    expect(served.headers.get("location")).toContain("next=%2Fadmin");
  });

  it("protected route with a query string redirects to /login?next=/admin?tab=x", async () => {
    const served = await serve(`${ORIGIN}/admin?tab=x`, {}, OPTIONS);

    expect(served.status).toBe(302);
    const location = new URL(served.headers.get("location") ?? "", ORIGIN);
    expect(`${location.pathname}${location.search}`).toBe("/login?next=%2Fadmin%3Ftab%3Dx");
  });

  it("does not nest a next parameter the request already carries", async () => {
    const served = await serve(`${ORIGIN}/admin?tab=x&next=%2Fbilling`, {}, OPTIONS);

    expect(served.status).toBe(302);
    const location = new URL(served.headers.get("location") ?? "", ORIGIN);
    expect(location.searchParams.getAll("next")).toEqual(["/admin?tab=x"]);
  });

  // Routers that canonicalise to a trailing slash request `/profile/`, which
  // must not slip past `protectedRoutes: ["/profile"]`.
  it("protected route requested with a trailing slash redirects to login", async () => {
    const served = await serve(
      `${ORIGIN}/profile/`,
      {},
      { ...OPTIONS, protectedRoutes: ["/profile"] },
    );

    expect(served.status).toBe(302);
    expect(served.headers.get("location")).toContain("/login");
  });

  it("protected route with a valid cookie token authenticates", async () => {
    const sign = signer();
    const token = sign();

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SESSION}=${token}` } },
      OPTIONS,
    );

    expect(served.answered).toBe(false);
    expect(served.auth).toMatchObject({ isAuthenticated: true, session: { token } });
  });

  it("protected route with a valid Bearer token authenticates", async () => {
    const sign = signer();
    const token = sign();

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { authorization: `Bearer ${token}` } },
      OPTIONS,
    );

    expect(served.answered).toBe(false);
    expect(served.auth).toMatchObject({ isAuthenticated: true, session: { token } });
  });

  it("Bearer token takes precedence over the session cookie", async () => {
    const sign = signer();
    const bearer = sign({ sub: "bearer-user" });
    const cookie = sign({ sub: "cookie-user" });

    const served = await serve(
      `${ORIGIN}/`,
      { headers: { authorization: `Bearer ${bearer}`, cookie: `${SESSION}=${cookie}` } },
      OPTIONS,
    );

    expect(served.auth).toMatchObject({ isAuthenticated: true, session: { token: bearer } });
  });

  it("token with no sub claim is treated as unauthenticated", async () => {
    const sign = signer();
    const token = sign({ sub: undefined });

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SESSION}=${token}` } },
      OPTIONS,
    );

    expect(served.status).toBe(302);
  });

  it("token with no sub claim is rejected on a protected route", async () => {
    const sign = signer();
    const token = sign({ sub: undefined });

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SESSION}=${token}` } },
      OPTIONS,
    );

    expect(served.headers.get("location")).toContain("/login");
  });

  it("token with no sub claim continues as unauthenticated on a public route", async () => {
    const sign = signer();
    const token = sign({ sub: undefined });

    const served = await serve(
      `${ORIGIN}/`,
      { headers: { cookie: `${SESSION}=${token}` } },
      OPTIONS,
    );

    expect(served.answered).toBe(false);
    expect(served.auth?.isAuthenticated).toBe(false);
  });

  it("token with a disallowed typ is rejected", async () => {
    const sign = signer();
    const token = sign({}, "refresh_token");

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SESSION}=${token}` } },
      { ...OPTIONS, allowedTokenTypes: ["JWT", "at+JWT"] },
    );

    expect(served.status).toBe(302);
  });

  it("token with a disallowed algorithm is rejected", async () => {
    const sign = signer();
    const token = sign();

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SESSION}=${token}` } },
      { ...OPTIONS, allowedAlgorithms: ["ES256"] },
    );

    expect(served.status).toBe(302);
  });

  it('token with alg "none" is rejected without fetching JWKS', async () => {
    const sign = signer();
    const token = sign({}, "JWT", "none");

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SESSION}=${token}` } },
      OPTIONS,
    );

    expect(served.status).toBe(302);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("RS256 tokens are accepted by default", async () => {
    const sign = signer();
    const token = sign();

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SESSION}=${token}` } },
      OPTIONS,
    );

    expect(served.answered).toBe(false);
    expect(served.auth?.isAuthenticated).toBe(true);
  });

  it("redirect preserves existing query params in loginPath", async () => {
    const served = await serve(`${ORIGIN}/admin`, {}, { ...OPTIONS, loginPath: "/login?tab=sso" });

    expect(served.status).toBe(302);
    const parsed = new URL(served.headers.get("location") ?? "", ORIGIN);
    expect(parsed.searchParams.get("tab")).toBe("sso");
    expect(parsed.searchParams.get("next")).toBe("/admin");
  });

  it("invalid token clears the stale session cookie and redirects", async () => {
    const sign = signer();
    const parts = sign().split(".");
    const tampered = `${parts[0]}.${parts[1]}.invalidsig`;

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SESSION}=${tampered}` } },
      OPTIONS,
    );

    expect(served.status).toBe(302);
    expect(served.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION}=;`));
    expect(served.headers.get("set-cookie")).toMatch(/Max-Age=0|expires=.*1970/i);
  });

  it("accepts a relative loginPath and redirects correctly", async () => {
    const served = await serve(`${ORIGIN}/admin`, {}, { ...OPTIONS, loginPath: "/custom-login" });

    expect(served.status).toBe(302);
    expect(served.headers.get("location")).toContain("/custom-login");
  });

  it("absolute loginPath throws", async () => {
    await expect(
      serve(`${ORIGIN}/admin`, {}, { ...OPTIONS, loginPath: "https://evil.example.com/phish" }),
    ).rejects.toThrow(/loginPath must be a relative path/i);
  });

  it("protocol-relative loginPath throws", async () => {
    await expect(
      serve(`${ORIGIN}/admin`, {}, { ...OPTIONS, loginPath: "//evil.example.com/phish" }),
    ).rejects.toThrow(/loginPath must be a relative path/i);
  });

  it("refuses a request that carries the auth header on the proxy path", async () => {
    const calls = captureFetch();

    const served = await serve(
      `${ORIGIN}/__nextgen/v1/flow`,
      { headers: { "x-nextgen-auth-token": "forged" } },
      PROXY,
    );

    expect(served.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("forwards upstream Set-Cookie headers", async () => {
    const upstream = new Headers();
    upstream.append("set-cookie", `${SHARED}=abc; HttpOnly; SameSite=Lax`);
    captureFetch(() => new Response("{}", { status: 200, headers: upstream }));

    const served = await serve(`${ORIGIN}/__nextgen/v1/flow`, {}, PROXY);

    expect(served.headers.get("set-cookie")).toBe(`${SHARED}=abc; HttpOnly; SameSite=Lax`);
  });

  it("passes cookies through to the backend when no project is configured", async () => {
    const calls = captureFetch();

    await serve(
      `${ORIGIN}/__nextgen/sessions/me`,
      { headers: { cookie: `${SHARED}=tok; theme=dark` } },
      { ...PROXY, ...configureProject(undefined, undefined) },
    );

    expect(calls[0]?.headers.get("cookie")).toBe(`${SHARED}=tok; theme=dark`);
  });

  it("names a proxied session cookie for this app's project", async () => {
    const upstream = new Headers();
    upstream.append("set-cookie", `${SHARED}=abc; Path=/; HttpOnly; SameSite=Lax`);
    captureFetch(() => new Response("{}", { status: 200, headers: upstream }));

    const served = await serve(
      `${ORIGIN}/__nextgen/sessions/exchange`,
      { method: "POST" },
      APP_PROXY,
    );

    expect(served.headers.get("set-cookie")).toBe(`${SESSION}=abc; Path=/; HttpOnly; SameSite=Lax`);
  });

  it("sends this project's session cookie upstream under the server's name", async () => {
    const calls = captureFetch();

    await serve(
      `${ORIGIN}/__nextgen/users/me`,
      { headers: { cookie: `theme=dark; ${SESSION}=mine` } },
      APP_PROXY,
    );

    expect(calls[0]?.headers.get("cookie")).toBe(`theme=dark; ${SHARED}=mine`);
  });

  // The shared cookie may hold the Console's session, and another app's cookie
  // holds that app's: neither is this app's to use.
  it("keeps other projects' session cookies from the backend", async () => {
    const calls = captureFetch();

    await serve(
      `${ORIGIN}/__nextgen/sessions/me`,
      {
        method: "DELETE",
        headers: {
          cookie: `${SHARED}=console; __nextgen_session_${OTHER_PROJECT}=other; _zflow=f`,
        },
      },
      APP_PROXY,
    );

    expect(calls[0]?.headers.get("cookie")).toBe("_zflow=f");
  });

  // A session kept under the shared name before ADR 073 reaches the backend
  // only where the backend holds it to this project.
  it("sends the shared session cookie only to this project's session probe", async () => {
    const calls = captureFetch();
    const headers = { cookie: `${SHARED}=old` };

    await serve(`${ORIGIN}/__nextgen/sessions/me?project_id=${PROJECT}`, { headers }, APP_PROXY);
    await serve(`${ORIGIN}/__nextgen/sessions/me`, { method: "DELETE", headers }, APP_PROXY);

    expect(calls.map((call) => call.headers.get("cookie"))).toEqual([`${SHARED}=old`, null]);
  });

  it("moves this project's session out of the shared cookie on the session probe", async () => {
    const answer = {
      project_id: PROJECT,
      user_id: "u1",
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    };
    captureFetch(() => Response.json(answer));

    const served = await serve(
      `${ORIGIN}/__nextgen/sessions/me?project_id=${PROJECT}`,
      { headers: { cookie: `${SHARED}=old` } },
      APP_PROXY,
    );

    expect(JSON.parse(served.body)).toEqual(answer);
    expectMoved(served.headers, "old");
  });

  // The IdP callback answers 303 back to the page sign-in started on: a
  // top-level navigation, so a dropped Location strands the browser.
  it.each([
    ["/profile?signed=1", "http://localhost:3000/profile?signed=1"],
    ["http://localhost:3000/profile", "http://localhost:3000/profile"],
    ["http://internal:4000/profile", "http://localhost:3000/profile"],
  ])("forwards an upstream Location %s onto this app as %s", async (location, expected) => {
    captureFetch(() => new Response(null, { status: 303, headers: { location } }));

    const served = await serve(`${ORIGIN}/__nextgen/idp/callback?code=x`, {}, PROXY);

    expect(served.headers.get("location")).toBe(expected);
  });

  it("keeps a caller-supplied credential on the handoff exchange", async () => {
    const calls = captureFetch();

    await serve(
      `${ORIGIN}/__nextgen/sessions/exchange`,
      { method: "POST", headers: { authorization: "Bearer pk-caller" } },
      { ...PROXY, ...configureSecret("sk-1") },
    );

    expect(calls[0]?.headers.get("authorization")).toBe("Bearer pk-caller");
  });

  it("appends the client IP to an existing X-Forwarded-For chain", async () => {
    const calls = captureFetch();

    await serve(
      `${ORIGIN}/__nextgen/v1/flow`,
      { headers: { "x-forwarded-for": "10.0.0.1" }, clientIp: "10.0.0.2" },
      PROXY,
    );

    expect(calls[0]?.headers.get("x-forwarded-for")).toBe("10.0.0.1, 10.0.0.2");
  });

  it("sets X-Forwarded-For from the client IP when no chain exists", async () => {
    const calls = captureFetch();

    await serve(`${ORIGIN}/__nextgen/v1/flow`, { clientIp: "10.0.0.2" }, PROXY);

    expect(calls[0]?.headers.get("x-forwarded-for")).toBe("10.0.0.2");
  });

  it("omits X-Forwarded-For when no client IP is available", async () => {
    const calls = captureFetch();

    await serve(`${ORIGIN}/__nextgen/v1/flow`, { headers: { "x-real-ip": "10.9.9.9" } }, PROXY);

    expect(calls[0]?.headers.has("x-forwarded-for")).toBe(false);
  });

  it("ignores a client-supplied x-real-ip when the runtime provides an address", async () => {
    const calls = captureFetch();

    await serve(
      `${ORIGIN}/__nextgen/v1/flow`,
      { headers: { "x-real-ip": "10.9.9.9" }, clientIp: "10.0.0.2" },
      PROXY,
    );

    expect(calls[0]?.headers.get("x-forwarded-for")).toBe("10.0.0.2");
  });

  it("ignores a client-supplied x-real-ip when an X-Forwarded-For chain exists", async () => {
    const calls = captureFetch();

    await serve(
      `${ORIGIN}/__nextgen/v1/flow`,
      { headers: { "x-forwarded-for": "10.0.0.1", "x-real-ip": "10.9.9.9" }, clientIp: "10.0.0.2" },
      PROXY,
    );

    expect(calls[0]?.headers.get("x-forwarded-for")).toBe("10.0.0.1, 10.0.0.2");
  });

  it("does not proxy a path that only shares the prefix without a separator", async () => {
    const calls = captureFetch();

    const served = await serve(`${ORIGIN}/__nextgen-evil/resource`, {}, PROXY);

    expect(calls).toHaveLength(0);
    expect(served.answered).toBe(false);
  });

  it("skips auth handling on an ignored route", async () => {
    const served = await serve(
      `${ORIGIN}/health`,
      {},
      { ...OPTIONS, protectedRoutes: ["/health"], ignoredRoutes: ["/health"] },
    );

    expect(served.answered).toBe(false);
    expect(served.status).toBe(200);
    expect(served.auth?.isAuthenticated ?? false).toBe(false);
  });

  it("hands the auth result to the next handler when the request continues", async () => {
    const sign = signer();
    const token = sign();

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SESSION}=${token}` } },
      OPTIONS,
    );

    expect(served.answered).toBe(false);
    expect(served.status).toBe(200);
    expect(served.auth).toMatchObject({ isAuthenticated: true, session: { token } });
  });

  // A handler run where the middleware did not run has no session to read.
  it.each([[undefined], [{}]])("reads a missing session from %j as signed out", async (context) => {
    expect(await readAuth(context)).toEqual({ isAuthenticated: false, session: null });
  });

  it("returns the redirect without continuing on a protected route miss", async () => {
    const served = await serve(`${ORIGIN}/admin`, {}, OPTIONS);

    expect(served.answered).toBe(true);
    expect(served.status).toBe(302);
    expect(served.headers.get("location")).toContain("/login");
  });

  // Checked by `tsc -p tsconfig.spec.json`.
  it("is assignable to the framework's request handler type", () => {
    expectHandlerType();
  });

  it("signs in a live session that names a user", async () => {
    sessionsMe(
      Response.json({
        project_id: PROJECT,
        user_id: "u1",
        user: { identifier: "ada@example.com", identifier_property: "email", display: "Ada" },
      }),
    );

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SESSION}=opaque-session-token` } },
      OPTIONS,
    );

    expect(served.answered).toBe(false);
    expect(served.auth).toMatchObject({
      isAuthenticated: true,
      session: { token: "opaque-session-token" },
    });
  });

  // CreateSession sets the cookie before any factor is verified: an abandoned
  // sign-in must not open protected routes.
  it("redirects an anonymous session on a protected route to login", async () => {
    sessionsMe(Response.json({ project_id: PROJECT }));

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SESSION}=opaque-session-token` } },
      OPTIONS,
    );

    expect(served.status).toBe(302);
  });

  it("keeps an anonymous session's cookie, since its sign-in may still complete", async () => {
    sessionsMe(Response.json({ project_id: PROJECT }));

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SESSION}=opaque-session-token` } },
      OPTIONS,
    );

    expect(served.headers.get("set-cookie")).toBeNull();
  });

  it("clears a dead session cookie on a public page", async () => {
    sessionsMe(new Response(null, { status: 401 }));

    const served = await serve(
      `${ORIGIN}/`,
      { headers: { cookie: `${SESSION}=opaque-session-token` } },
      OPTIONS,
    );

    expect(served.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION}=;`));
    expect(served.headers.get("set-cookie")).toMatch(/Max-Age=0|expires=.*1970/i);
  });

  it("clears a dead session cookie and redirects on a protected route", async () => {
    sessionsMe(new Response(null, { status: 401 }));

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SESSION}=opaque-session-token` } },
      OPTIONS,
    );

    expect(served.status).toBe(302);
    expect(served.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION}=;`));
    expect(served.headers.get("set-cookie")).toMatch(/Max-Age=0|expires=.*1970/i);
  });

  it("clears the cookie of a session that is gone", async () => {
    sessionsMe(
      Response.json(
        { code: "sess.not_found", message: "The session was not found" },
        { status: 404 },
      ),
    );

    const served = await serve(
      `${ORIGIN}/`,
      { headers: { cookie: `${SESSION}=opaque-session-token` } },
      OPTIONS,
    );

    expect(served.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION}=;`));
    expect(served.headers.get("set-cookie")).toMatch(/Max-Age=0|expires=.*1970/i);
  });

  // The backend answers 500, never 401, when it cannot decide whether a session
  // is live (its token or key store failed), so that an outage does not sign
  // every user out. Only its refusal makes a cookie dead.
  describe.each([
    ["a 500", () => sessionsMe(new Response(null, { status: 500 }))],
    ["no answer in time", sessionsMeSilent],
    ["a network error", sessionsMeUnreachable],
  ])("when the session check gets %s", (_label, backend) => {
    // Short, so that a backend that never answers times out quickly.
    const options: ServeOptions = { ...OPTIONS, opaqueTokenTimeoutMs: 10 };

    beforeEach(() => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      backend();
    });

    it("keeps the session cookie and renders a public page signed out", async () => {
      const served = await serve(
        `${ORIGIN}/`,
        { headers: { cookie: `${SESSION}=opaque-session-token` } },
        options,
      );

      expect(served.answered).toBe(false);
      expect(served.auth).toEqual({ isAuthenticated: false, session: null });
      expect(served.headers.get("set-cookie")).toBeNull();
    });

    it("answers 503 on a protected route and keeps the session cookie", async () => {
      const served = await serve(
        `${ORIGIN}/admin`,
        { headers: { cookie: `${SESSION}=opaque-session-token` } },
        options,
      );

      expect(served.answered).toBe(true);
      expect(served.status).toBe(503);
      expect(served.headers.get("set-cookie")).toBeNull();
    });
  });

  it("does not sign in a live session of another project", async () => {
    sessionsMe(Response.json({ project_id: OTHER_PROJECT, user_id: "u1" }));

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SHARED}=opaque-session-token` } },
      OPTIONS,
    );

    expect(served.status).toBe(302);
    expect(served.headers.get("location")).toContain("/login");
  });

  it("reads a live session of another project as signed out on a public page", async () => {
    sessionsMe(Response.json({ project_id: OTHER_PROJECT, user_id: "u1" }));

    const served = await serve(
      `${ORIGIN}/`,
      { headers: { cookie: `${SHARED}=opaque-session-token` } },
      OPTIONS,
    );

    expect(served.answered).toBe(false);
    expect(served.auth?.isAuthenticated).toBe(false);
  });

  // That session is live in its own project: clearing the cookie would sign the
  // person out of the app it belongs to.
  it("keeps the cookie of another project's session", async () => {
    sessionsMe(Response.json({ project_id: OTHER_PROJECT, user_id: "u1" }));

    const served = await serve(
      `${ORIGIN}/`,
      { headers: { cookie: `${SHARED}=opaque-session-token` } },
      OPTIONS,
    );

    expect(served.headers.get("set-cookie")).toBeNull();
  });

  it("reads the session from this project's cookie before the shared one", async () => {
    const calls = captureFetch(() => Response.json({ project_id: PROJECT, user_id: "u1" }));

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SHARED}=console; ${SESSION}=mine` } },
      OPTIONS,
    );

    expect(served.auth).toMatchObject({ isAuthenticated: true, session: { token: "mine" } });
    expect(calls[0]?.headers.get("cookie")).toBe(`${SHARED}=mine`);
    expect(served.headers.get("set-cookie")).toBeNull();
  });

  it("ignores the session cookie of another project's app", async () => {
    const calls = captureFetch();

    const served = await serve(
      `${ORIGIN}/`,
      { headers: { cookie: `__nextgen_session_${OTHER_PROJECT}=other` } },
      OPTIONS,
    );

    expect(served.auth?.isAuthenticated).toBe(false);
    expect(calls).toHaveLength(0);
    expect(served.headers.get("set-cookie")).toBeNull();
  });

  // A session this app's users signed in to before ADR 073 sits under the
  // shared name; it moves the first time the app reads it.
  it("moves this project's session out of the shared cookie", async () => {
    sessionsMe(
      Response.json({
        project_id: PROJECT,
        user_id: "u1",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SHARED}=opaque-session-token` } },
      OPTIONS,
    );

    expect(served.auth).toMatchObject({
      isAuthenticated: true,
      session: { token: "opaque-session-token" },
    });
    expectMoved(served.headers, "opaque-session-token");
  });

  it("clears only this project's dead session cookie", async () => {
    sessionsMe(new Response(null, { status: 401 }));

    const served = await serve(
      `${ORIGIN}/`,
      {
        headers: {
          cookie: `${SHARED}=console; __nextgen_session_${OTHER_PROJECT}=other; ${SESSION}=dead`,
        },
      },
      OPTIONS,
    );

    const cleared = served.headers.getSetCookie();
    expect(cleared).toHaveLength(1);
    expect(cleared[0]).toMatch(new RegExp(`^${SESSION}=;`));
    expect(cleared[0]).toMatch(/Max-Age=0|expires=.*1970/i);
  });

  it("asks the backend for the session in this app's project", async () => {
    const calls = captureFetch(() => Response.json({ project_id: PROJECT, user_id: "u1" }));

    await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SESSION}=opaque-session-token` } },
      OPTIONS,
    );

    expect(new URL(calls[0]?.url ?? "").searchParams.get("project_id")).toBe(PROJECT);
  });

  it("does not sign in a session the backend refuses for this project", async () => {
    sessionsMe(
      Response.json(
        { code: "sess.project_mismatch", message: "The session belongs to a different project." },
        { status: 403 },
      ),
    );

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SHARED}=opaque-session-token` } },
      OPTIONS,
    );

    expect(served.status).toBe(302);
    expect(served.headers.get("set-cookie")).toBeNull();
  });

  it.each([
    ["another project", OTHER_PROJECT],
    ["no project", undefined],
  ])("does not sign in a JWT issued for %s", async (_l, aud) => {
    const sign = signer();
    const token = sign({ aud });

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SHARED}=${token}` } },
      OPTIONS,
    );

    expect(served.status).toBe(302);
  });

  it("does not sign in a Bearer JWT issued for another project", async () => {
    const sign = signer();
    const token = sign({ aud: OTHER_PROJECT });

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { authorization: `Bearer ${token}` } },
      OPTIONS,
    );

    expect(served.status).toBe(302);
  });

  it("keeps the cookie of a JWT issued for another project", async () => {
    const sign = signer();
    const token = sign({ aud: OTHER_PROJECT });

    const served = await serve(
      `${ORIGIN}/`,
      { headers: { cookie: `${SHARED}=${token}` } },
      OPTIONS,
    );

    expect(served.headers.get("set-cookie")).toBeNull();
  });

  it("signs in a JWT whose audience includes this project", async () => {
    const sign = signer();
    const token = sign({ aud: ["https://api.example.com", PROJECT] });

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SESSION}=${token}` } },
      OPTIONS,
    );

    expect(served.answered).toBe(false);
    expect(served.auth).toMatchObject({ isAuthenticated: true, session: { token } });
  });

  // Without a project there is nothing to hold a session against.
  it("signs in no one when no project is configured", async () => {
    sessionsMe(Response.json({ project_id: PROJECT, user_id: "u1" }));

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SHARED}=opaque-session-token` } },
      { ...OPTIONS, ...configureProject(undefined, undefined) },
    );

    expect(served.status).toBe(302);
  });

  it.each([
    ["the configuration", PROJECT, OTHER_PROJECT],
    ["the environment", undefined, PROJECT],
  ])("holds sessions to the project from %s", async (_l, configured, environment) => {
    sessionsMe(Response.json({ project_id: PROJECT, user_id: "u1" }));

    const served = await serve(
      `${ORIGIN}/admin`,
      { headers: { cookie: `${SESSION}=opaque-session-token` } },
      { ...OPTIONS, ...configureProject(configured, environment) },
    );

    expect(served.auth?.isAuthenticated).toBe(true);
  });

  it.each([
    ["GET", "/__nextgen/sessions/me"],
    ["DELETE", "/__nextgen/sessions/me"],
    ["POST", "/__nextgen/flow"],
    ["GET", "/__nextgen/projects"],
    ["GET", "/__nextgen/sessions/exchange"],
    ["POST", "/__nextgen/sessions/exchange/extra"],
  ])("does not attach the project secret to %s %s", async (method, pathname) => {
    const calls = captureFetch();

    await serve(
      `${ORIGIN}${pathname}`,
      { method },
      { ...PROXY, ...configureSecret("project-secret") },
    );

    expect(calls[0]?.headers.has("authorization")).toBe(false);
  });

  it("attaches the project secret only to POST /sessions/exchange, ignoring the query", async () => {
    const calls = captureFetch();

    await serve(
      `${ORIGIN}/__nextgen/sessions/exchange?source=browser`,
      { method: "POST" },
      { ...PROXY, ...configureSecret("project-secret") },
    );

    expect(calls[0]?.headers.get("authorization")).toBe("Bearer project-secret");
  });

  it("preserves the upstream session cache policy", async () => {
    captureFetch(
      () => new Response("{}", { status: 200, headers: { "cache-control": "private, no-store" } }),
    );

    const served = await serve(`${ORIGIN}/__nextgen/sessions/me`, {}, PROXY);

    expect(served.headers.get("cache-control")).toBe("private, no-store");
  });

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

    const served = await serve(`${ORIGIN}/__nextgen/v1/flow`, {}, PROXY);

    // Only the path is taken, so the upstream's own host never reaches the browser.
    expect(served.headers.get("location")).toBe("http://localhost:3000/callback");
    expect(served.headers.get("location")).not.toContain("internal-auth.corp");
    expect(served.headers.get("content-type")).toBe("application/json");
  });

  it("ignores a client-injected x-middleware-override-headers", async () => {
    captureFetch();

    const served = await serve(
      `${ORIGIN}/__nextgen/v1/flow`,
      { headers: { "x-middleware-override-headers": "x-evil-header,x-another-evil" } },
      PROXY,
    );

    expect(served.headers.get("x-middleware-override-headers")).toBeNull();
  });

  it("proxies an exact match of proxyPath", async () => {
    const calls = captureFetch();

    const served = await serve(`${ORIGIN}/__nextgen`, {}, PROXY);

    expect(calls).toHaveLength(1);
    expect(served.status).toBe(200);
  });

  it("proxies paths under proxyPath", async () => {
    const calls = captureFetch();

    const served = await serve(`${ORIGIN}/__nextgen/v1/flow`, {}, PROXY);

    expect(calls).toHaveLength(1);
    expect(served.status).toBe(200);
  });

  it("refuses a request that carries the auth header", async () => {
    const served = await serve(
      `${ORIGIN}/`,
      { headers: { "x-nextgen-auth-token": "forged" } },
      OPTIONS,
    );

    expect(served.answered).toBe(true);
    expect(served.status).toBe(400);
  });

  it("refuses a request that carries the auth header on an ignored route", async () => {
    const served = await serve(
      `${ORIGIN}/health`,
      { headers: { "x-nextgen-auth-token": "forged" } },
      { ...OPTIONS, ignoredRoutes: ["/health"] },
    );

    expect(served.answered).toBe(true);
    expect(served.status).toBe(400);
  });

  it("lets a request without the auth header through", async () => {
    const served = await serve(`${ORIGIN}/`, {}, OPTIONS);

    expect(served.answered).toBe(false);
    expect(served.status).toBe(200);
  });

  // An app that reads its secret from a secrets manager at runtime passes it in.
  it.each([
    ["the configuration", "sk_configured", "sk_environment", "Bearer sk_configured"],
    ["the environment", undefined, "sk_environment", "Bearer sk_environment"],
    ["nothing", undefined, undefined, null],
  ])("sends the exchange bearer from %s", async (_l, configured, environment, expected) => {
    const calls = captureFetch(() => Response.json({ session_id: "s1" }));

    await serve(
      `${ORIGIN}/__nextgen/sessions/exchange`,
      { method: "POST" },
      { ...PROXY, ...configureSecret(configured, environment) },
    );

    expect(calls[0]?.headers.get("authorization")).toBe(expected);
  });

  it.each([
    ["the option", "http://option.test:4000", "http://env.test:4000", "http://option.test:4000/"],
    ["ZITADEL_URL", undefined, "http://env.test:4000", "http://env.test:4000/"],
  ])("proxies to the backend from %s", async (_l, option, environment, expected) => {
    vi.stubEnv("ZITADEL_URL", environment);
    const calls = captureFetch();

    await serve(`${ORIGIN}/__nextgen/v1/flow`, {}, { url: option });

    expect(calls[0]?.url.startsWith(expected)).toBe(true);
  });
});
