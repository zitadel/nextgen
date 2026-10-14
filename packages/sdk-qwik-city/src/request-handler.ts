import type { AuthResult, NextgenMiddlewareOptions } from "@zitadel/sdk-core/middleware";

import {
  HOP_BY_HOP,
  INTERNAL_HEADERS,
  assertLoginPath,
  filterResponseHeaders,
  matchesRoutes,
  parseCookieHeader,
  proxyFailureResponse,
  requiresProjectSecret,
  sessionUnavailableResponse,
  validateOpaqueSessionToken,
} from "@zitadel/sdk-core/middleware";

import { isJwtShaped, verifyJwt } from "./lib/jwt";

/**
 * `process` is undefined in some edge/serverless runtimes; read env defensively
 * so the `process.env` fallback never throws a ReferenceError (Qwik City's
 * `ev.env` is the primary source).
 */
const PROCESS_ENV: Record<string, string | undefined> =
  typeof process !== "undefined" && process.env ? process.env : {};

/**
 * The slice of Qwik Router's `RequestEvent` this handler reads. `@qwik.dev/router`
 * is a peer, not a runtime dependency: typing only the handful of fields we
 * touch keeps the built output free of a Qwik import, the same way `sdk-nuxt`
 * shims Nuxt's `#imports`. The shape is structurally compatible with the real
 * `RequestEvent` (a type-level test asserts it), so the returned handler drops
 * straight into `export const onRequest = createNextgenOnRequest(...)`.
 */
export interface QwikCookieValue {
  readonly value: string;
}

export interface QwikRequestEvent {
  readonly request: Request;
  readonly url: URL;
  readonly sharedMap: Map<string, unknown>;
  readonly clientConn: { readonly ip?: string };
  readonly cookie: {
    get(name: string): QwikCookieValue | null;
    getAll(): Record<string, QwikCookieValue>;
    delete(name: string, options?: { path?: string }): void;
  };
  /** Sends a custom response and ends the chain. */
  send(response: Response): void;
  /** Returns a redirect marker to be thrown. */
  redirect(statusCode: number, url: string): unknown;
  /**
   * Qwik City's platform env getter. This is how server env reaches the
   * handler: Vite/Qwik load `.env`/`.env.local` into `ev.env`, NOT into
   * `process.env`, so `ZITADEL_URL` / `ZITADEL_PROJECT_SECRET` are read here
   * (mirroring SvelteKit's `$env/dynamic/private`). Optional so unit-test mocks
   * that exercise only the auth path need not stub it.
   */
  readonly env?: { get(key: string): string | undefined };
}

/**
 * Builds the upstream request headers: copies all incoming headers, drops
 * hop-by-hop and SDK-internal headers, and sets `X-Forwarded-*` so the auth
 * server sees the real client origin. The client IP comes from
 * `ev.clientConn.ip` (or any existing `X-Forwarded-For` chain).
 */
function buildUpstreamHeaders(ev: QwikRequestEvent): Headers {
  const headers = new Headers();
  for (const [key, value] of ev.request.headers) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || INTERNAL_HEADERS.has(lower)) {
      continue;
    }
    headers.set(key, value);
  }

  const clientIp = ev.clientConn.ip;
  if (clientIp) {
    const existingXff = headers.get("x-forwarded-for");
    headers.set("x-forwarded-for", existingXff ? `${existingXff}, ${clientIp}` : clientIp);
  }

  if (!headers.has("x-forwarded-host")) {
    headers.set("x-forwarded-host", ev.url.host);
  }

  if (!headers.has("x-forwarded-proto")) {
    headers.set("x-forwarded-proto", ev.url.protocol.replace(":", ""));
  }

  return headers;
}

/**
 * Forwards a `/__nextgen/*` request to the upstream auth backend and returns the
 * upstream response verbatim, including `Set-Cookie` headers. Hop-by-hop
 * headers are stripped in both directions, and a `location` is kept only as a
 * redirect onto this app.
 */
async function proxyResponse(
  ev: QwikRequestEvent,
  authUrl: string,
  proxyPath: string,
  projectSecret: string | undefined,
  proxyTimeoutMs: number,
): Promise<Response> {
  const suffix = ev.url.pathname.slice(proxyPath.length);
  const target = `${authUrl}${suffix}${ev.url.search}`;

  const method = ev.request.method;
  const hasBody = !["GET", "HEAD"].includes(method);
  const body = hasBody ? await ev.request.arrayBuffer() : undefined;

  const upstreamHeaders = buildUpstreamHeaders(ev);

  // ADR 036: attach the project secret only to the handoff exchange — on every
  // operation it would make this public boundary an open relay with project
  // authority. A caller-supplied credential is preserved.
  if (
    requiresProjectSecret(method, suffix) &&
    !upstreamHeaders.has("authorization") &&
    projectSecret
  ) {
    upstreamHeaders.set("authorization", `Bearer ${projectSecret}`);
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers: upstreamHeaders,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(proxyTimeoutMs),
    });
  } catch (error) {
    // The backend is down or too slow: a 502/504 in the API's error envelope,
    // not the framework's HTML 500 page.
    return proxyFailureResponse(error);
  }

  // The app's own request URL: the origin a proxied redirect may name, and the
  // base a relative one resolves against (the IdP callback's 303 needs it).
  const responseHeaders = filterResponseHeaders(upstream.headers, ev.url.toString());
  const setCookies = upstream.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookies) {
    responseHeaders.append("set-cookie", cookie);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

/** Key under which the auth result is stored on `ev.sharedMap`. */
const SHARED_MAP_KEY = "nextgenAuth";

interface AuthHandlerOptions {
  readonly url: string;
  readonly protectedRoutes: readonly string[];
  readonly loginPath: string;
  readonly allowedAlgorithms: readonly string[] | undefined;
  readonly clockSkewMs: number;
  readonly audience: string | readonly string[] | undefined;
  readonly allowedTokenTypes: readonly string[];
  readonly jwksTimeoutMs: number | undefined;
  readonly opaqueTokenTimeoutMs: number;
}

/**
 * Removes any client-supplied `x-nextgen-auth-token` from the inbound request,
 * so server code reading raw headers cannot observe an attacker-controlled
 * value; `getAuth(ev)` is canonical. Request headers may be immutable on some
 * adapters, so the delete is guarded.
 */
function stripAuthTokenHeader(ev: QwikRequestEvent): void {
  try {
    ev.request.headers.delete("x-nextgen-auth-token");
  } catch {
    // Immutable headers on this adapter — nothing to strip beyond what the
    // proxy path already drops via INTERNAL_HEADERS before forwarding.
  }
}

/**
 * Verifies the session token and writes the auth result to `ev.sharedMap`. On a
 * protected route with no valid session it throws `ev.redirect(...)` to send the
 * browser to the login page. Stale `__nextgen*` cookies are cleared when the
 * backend says the token is dead; when the backend cannot be asked, they stay
 * and a protected route answers `503`.
 */
async function handleAuth(ev: QwikRequestEvent, opts: AuthHandlerOptions): Promise<void> {
  const {
    url,
    protectedRoutes,
    loginPath,
    allowedAlgorithms,
    clockSkewMs,
    audience,
    allowedTokenTypes,
    jwksTimeoutMs,
    opaqueTokenTimeoutMs,
  } = opts;
  const { pathname } = ev.url;

  stripAuthTokenHeader(ev);

  const cookies = parseCookieHeader(ev.request.headers.get("cookie"));
  const authHeader = ev.request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const cookieToken =
    ev.cookie.get("__nextgen_session")?.value ?? cookies.get("__nextgen_session") ?? null;
  // Bearer token takes explicit precedence over the session cookie.
  const token = bearerToken ?? cookieToken;

  const payload = token
    ? await verifyJwt(token, {
        issuerUrl: url,
        allowedAlgorithms,
        clockSkewMs,
        audience,
        allowedTokenTypes,
        jwksTimeoutMs,
      })
    : null;

  if (payload && token && payload.sub) {
    ev.sharedMap.set(SHARED_MAP_KEY, {
      isAuthenticated: true,
      session: {
        userId: payload.sub,
        identifier: payload.email ?? null,
        identifierProperty: null,
        display: payload.name ?? null,
        token,
      },
    } satisfies AuthResult);
    return;
  }

  let keepCookies = false;
  if (!payload && cookieToken && !isJwtShaped(cookieToken)) {
    const check = await validateOpaqueSessionToken(cookieToken, url, opaqueTokenTimeoutMs);
    if (check.status === "live" && check.session.userId) {
      ev.sharedMap.set(SHARED_MAP_KEY, {
        isAuthenticated: true,
        session: {
          userId: check.session.userId,
          identifier: check.session.identifier,
          identifierProperty: check.session.identifierProperty,
          display: check.session.display,
          token: cookieToken,
        },
      } satisfies AuthResult);
      return;
    }
    // A session without a user is anonymous: its sign-in has not verified a
    // factor yet. It is not signed in, but it is live — keep its cookie.
    keepCookies = check.status === "live";
    if (check.status === "unknown") {
      // The backend could not be asked. The session may be live, so its cookie
      // survives the outage; a protected route is retryable, not a sign-in.
      ev.sharedMap.set(SHARED_MAP_KEY, {
        isAuthenticated: false,
        session: null,
      } satisfies AuthResult);
      if (matchesRoutes(pathname, protectedRoutes)) {
        ev.send(sessionUnavailableResponse());
      }
      return;
    }
  }

  ev.sharedMap.set(SHARED_MAP_KEY, {
    isAuthenticated: false,
    session: null,
  } satisfies AuthResult);

  // Dead credentials are cleared on every unauthenticated response so the
  // browser stops replaying them (each replay costs a backend session check);
  // a live anonymous session's cookie stays, since its sign-in may complete.
  // Qwik applies the deletion to whichever response goes out.
  if (!keepCookies) {
    for (const name of Object.keys(ev.cookie.getAll())) {
      if (name.startsWith("__nextgen")) {
        ev.cookie.delete(name, { path: "/" });
      }
    }
  }

  if (matchesRoutes(pathname, protectedRoutes)) {
    const loginUrl = new URL(loginPath, ev.url);
    loginUrl.searchParams.set("next", pathname);
    throw ev.redirect(302, `${loginUrl.pathname}${loginUrl.search}`);
  }
}

/**
 * Creates a Qwik City `RequestHandler` that handles proxying, JWT verification,
 * and route protection in a single `onRequest` pass.
 *
 * Place it in a layout or root plugin, e.g. `src/routes/plugin@nextgen.ts`:
 *
 * ```ts
 * import { createNextgenOnRequest } from "@zitadel/sdk-qwik-city/server";
 *
 * export const onRequest = createNextgenOnRequest({
 *   protectedRoutes: ["/admin*", "/dashboard*"],
 *   loginPath: "/login",
 * });
 * ```
 *
 * `url` and `projectSecret` default to `ZITADEL_URL` / `ZITADEL_PROJECT_SECRET`,
 * read per request from `ev.env` (where Vite loads `.env.local`), then
 * `process.env`.
 *
 * @param options - Configuration. `projectSecret` is the project service-key
 *   sent as the bearer on the `POST /sessions/exchange` handoff only.
 * @returns A Qwik City `RequestHandler`.
 */
export function createNextgenOnRequest(
  options: NextgenMiddlewareOptions & { projectSecret?: string } = {},
): (ev: QwikRequestEvent) => Promise<void> {
  const {
    url: urlOption,
    proxyPath = "/__nextgen",
    protectedRoutes = [],
    ignoredRoutes = [],
    loginPath = "/login",
    allowedAlgorithms = ["RS256", "ES256"] as const,
    clockSkewMs = 5000,
    audience,
    allowedTokenTypes = ["JWT", "at+JWT"],
    jwksTimeoutMs,
    proxyTimeoutMs = 5000,
    opaqueTokenTimeoutMs = 5000,
    projectSecret: projectSecretOption,
  } = options;

  // Guard against open-redirect: loginPath must be a path on this app.
  assertLoginPath(loginPath);

  return async (ev: QwikRequestEvent): Promise<void> => {
    const { pathname } = ev.url;

    // Resolve the backend URL and project secret per request. Precedence:
    // explicit option > Qwik City's `ev.env` (which carries `.env.local`) >
    // `process.env` (set in production adapters) > localhost default. Qwik does
    // not surface `.env` files on `process.env`, so a factory-time read would
    // miss them and the proxy would fall back to :8080 ("fetch failed").
    const url =
      urlOption ?? ev.env?.get("ZITADEL_URL") ?? PROCESS_ENV.ZITADEL_URL ?? "http://localhost:8080";
    const projectSecret =
      projectSecretOption ??
      ev.env?.get("ZITADEL_PROJECT_SECRET") ??
      PROCESS_ENV.ZITADEL_PROJECT_SECRET;

    if (matchesRoutes(pathname, ignoredRoutes)) {
      stripAuthTokenHeader(ev);
      return;
    }

    if (pathname === proxyPath || pathname.startsWith(`${proxyPath}/`)) {
      ev.send(await proxyResponse(ev, url, proxyPath, projectSecret, proxyTimeoutMs));
      return;
    }

    await handleAuth(ev, {
      url,
      protectedRoutes,
      loginPath,
      allowedAlgorithms,
      clockSkewMs,
      audience,
      allowedTokenTypes,
      jwksTimeoutMs,
      opaqueTokenTimeoutMs,
    });
  };
}

/**
 * Reads the auth state from a Qwik City request event after the handler has run.
 * Call it inside a `routeLoader$`, `routeAction$`, or endpoint:
 *
 * ```ts
 * import { getAuth } from "@zitadel/sdk-qwik-city/server";
 *
 * export const useUser = routeLoader$((ev) => {
 *   const auth = getAuth(ev);
 *   if (!auth.isAuthenticated) throw ev.redirect(302, "/login");
 *   return auth.session.userId;
 * });
 * ```
 *
 * @param ev - The current Qwik City request event.
 * @returns The current {@link AuthResult}.
 */
export function getAuth(ev: { sharedMap: Map<string, unknown> }): AuthResult {
  return (
    (ev.sharedMap.get(SHARED_MAP_KEY) as AuthResult | undefined) ?? {
      isAuthenticated: false,
      session: null,
    }
  );
}
