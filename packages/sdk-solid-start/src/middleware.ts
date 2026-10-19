import type {
  AuthResult,
  NextgenMiddlewareOptions,
  ResolveSessionOptions,
} from "@zitadel/sdk-core/middleware";

import {
  HOP_BY_HOP,
  INTERNAL_HEADERS,
  filterResponseHeaders,
  matchesRoutes,
  requiresProjectSecret,
  resolveSession,
} from "@zitadel/sdk-core/middleware";

/**
 * `process` is undefined in some edge/serverless runtimes; read env defensively
 * so omitting `url`/`projectSecret` falls back to the default instead of throwing
 * a ReferenceError.
 */
const PROCESS_ENV: Record<string, string | undefined> =
  typeof process !== "undefined" && process.env ? process.env : {};

/**
 * The slice of SolidStart's `FetchEvent` this middleware reads. SolidStart (and
 * its Vinxi/Nitro substrate) is not a dependency of this package — typing the
 * handful of fields we touch keeps the install light and resilient to the
 * framework's bundler churn, the same way `sdk-nuxt` shims Nuxt's `#imports`.
 * The shape is structurally compatible with the real `FetchEvent`, so the
 * returned handler drops straight into `createMiddleware({ onRequest: [...] })`.
 */
export interface SolidFetchEvent {
  readonly request: Request;
  readonly locals: Record<string, unknown> & { nextgenAuth?: AuthResult };
  /** Direct client address, when the platform adapter resolves one. */
  readonly clientAddress?: string;
  /**
   * The response stub SolidStart merges into the response it eventually sends;
   * a middleware that continues sets headers (here, clearing cookies) on it.
   */
  readonly response?: { readonly headers: Headers };
}

/**
 * The `{ onRequest }` config `createNextgenMiddleware` returns. On SolidStart 2
 * pass it to `createMiddleware` from `@solidjs/start/middleware` and export
 * that as the default of the file named by `solidStart({ middleware })` — a
 * bare config object registers nothing. `onRequest` is a mutable array because
 * `createMiddleware` does not accept a readonly one.
 */
export interface SolidMiddlewareConfig {
  readonly onRequest: Array<(event: SolidFetchEvent) => Promise<Response | undefined>>;
}

/**
 * Parses a `Cookie` request header into a name→value map.
 */
function parseCookieHeader(header: string | null): Map<string, string> {
  const jar = new Map<string, string>();
  if (!header) return jar;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) jar.set(name, value);
  }
  return jar;
}

/**
 * Builds the upstream request headers: copies all incoming headers, drops
 * hop-by-hop and SDK-internal headers, and sets `X-Forwarded-*` so the auth
 * server sees the real client origin. The client IP comes from
 * `event.clientAddress` (or any existing `X-Forwarded-For` chain).
 */
function buildUpstreamHeaders(event: SolidFetchEvent, url: URL): Headers {
  const headers = new Headers();
  for (const [key, value] of event.request.headers) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || INTERNAL_HEADERS.has(lower)) {
      continue;
    }
    headers.set(key, value);
  }

  const clientIp = event.clientAddress;
  if (clientIp) {
    const existingXff = headers.get("x-forwarded-for");
    headers.set("x-forwarded-for", existingXff ? `${existingXff}, ${clientIp}` : clientIp);
  }

  if (!headers.has("x-forwarded-host")) {
    headers.set("x-forwarded-host", url.host);
  }

  if (!headers.has("x-forwarded-proto")) {
    headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
  }

  return headers;
}

/**
 * Forwards a `/__nextgen/*` request to the upstream auth backend and returns the
 * upstream response verbatim, including `Set-Cookie` headers. Hop-by-hop
 * headers are stripped in both directions, and a `location` is kept only as a
 * redirect onto this app.
 */
async function proxyRequest(
  event: SolidFetchEvent,
  url: URL,
  authUrl: string,
  proxyPath: string,
  projectSecret: string | undefined,
  proxyTimeoutMs: number,
): Promise<Response> {
  const suffix = url.pathname.slice(proxyPath.length);
  const target = `${authUrl}${suffix}${url.search}`;

  const method = event.request.method;
  const hasBody = !["GET", "HEAD"].includes(method);
  const body = hasBody ? await event.request.arrayBuffer() : undefined;

  const upstreamHeaders = buildUpstreamHeaders(event, url);

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

  const upstream = await fetch(target, {
    method,
    headers: upstreamHeaders,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(proxyTimeoutMs),
  });

  // The app's own request URL: the origin a proxied redirect may name, and the
  // base a relative one resolves against (the IdP callback's 303 needs it).
  const responseHeaders = filterResponseHeaders(upstream.headers, url.toString());
  const setCookies = upstream.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookies) {
    responseHeaders.append("set-cookie", cookie);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

/** A `Set-Cookie` value that clears `name` on the root path. */
function clearCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0`;
}

/**
 * The route policy, plus what the shared {@link resolveSession} judges the
 * session by.
 */
interface AuthHandlerOptions extends ResolveSessionOptions {
  readonly protectedRoutes: readonly string[];
  readonly loginPath: string;
}

/**
 * Judges the session, writes the auth result to `event.locals`, and returns a
 * redirect `Response` on a protected route when nobody is signed in (otherwise
 * `undefined` to continue). Stale `__nextgen*` cookies are cleared when they
 * hold dead credentials.
 */
async function handleAuth(
  event: SolidFetchEvent,
  url2: URL,
  opts: AuthHandlerOptions,
): Promise<Response | undefined> {
  const { protectedRoutes, loginPath, ...verification } = opts;
  const { pathname } = url2;

  const cookies = parseCookieHeader(event.request.headers.get("cookie"));
  const authHeader = event.request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const cookieToken = cookies.get("__nextgen_session") ?? null;
  const { auth, clearCookies } = await resolveSession(
    { bearer: bearerToken, cookie: cookieToken },
    verification,
  );

  event.locals.nextgenAuth = auth;
  if (auth.isAuthenticated) {
    return;
  }

  // Dead credentials are cleared on every unauthenticated response so the
  // browser stops replaying them (each replay costs a backend session check);
  // a live session that signs no one in here (an anonymous one, whose sign-in
  // may still complete, or one of another project) keeps its cookie.
  const staleCookies = clearCookies
    ? [...cookies.keys()].filter((name) => name.startsWith("__nextgen"))
    : [];

  if (matchesRoutes(pathname, protectedRoutes)) {
    const loginUrl = new URL(loginPath, url2);
    loginUrl.searchParams.set("next", pathname);
    const headers = new Headers({ location: loginUrl.toString() });
    for (const name of staleCookies) {
      headers.append("set-cookie", clearCookie(name));
    }
    return new Response(null, { status: 302, headers });
  }

  // Unprotected route: continue the SolidStart pipeline, which merges the
  // response stub's headers into the response it sends.
  for (const name of staleCookies) {
    event.response?.headers.append("set-cookie", clearCookie(name));
  }
  return undefined;
}

/**
 * Creates a SolidStart middleware config that handles proxying, JWT
 * verification, and route protection in a single `onRequest` pass.
 *
 * Reference it from the `middleware` option (the `solidStart()` plugin in
 * `vite.config.ts`, or `app.config.ts` on older setups), then in that file wrap
 * the config in SolidStart's own `createMiddleware`:
 *
 * ```ts
 * import { createMiddleware } from "@solidjs/start/middleware";
 * import { createNextgenMiddleware } from "@zitadel/sdk-solid-start/server";
 *
 * export default createMiddleware(
 *   createNextgenMiddleware({
 *     url: process.env.ZITADEL_URL,
 *     projectSecret: process.env.ZITADEL_PROJECT_SECRET,
 *     protectedRoutes: ["/admin*", "/dashboard*"],
 *     loginPath: "/login",
 *   }),
 * );
 * ```
 *
 * SolidStart 2 registers the middleware module's default export as an array of
 * h3 middleware, and `createMiddleware` turns the `{ onRequest }` config into
 * that array. Exporting the bare config registers nothing, so `/__nextgen/*`
 * would 404. To compose with your own handlers, pass them in the same call:
 * `createMiddleware({ onRequest: [...createNextgenMiddleware(...).onRequest, mine] })`.
 *
 * A session counts only in the app's own project: `projectId`, else
 * `ZITADEL_PROJECT_ID`, else `VITE_ZITADEL_PROJECT_ID`.
 *
 * @param options - Middleware configuration. `projectSecret` is the project
 *   service-key, sent as the bearer on the `POST /sessions/exchange` handoff only.
 * @returns A SolidStart middleware config object.
 */
export function createNextgenMiddleware(
  options: NextgenMiddlewareOptions & { projectSecret?: string } = {},
): SolidMiddlewareConfig {
  const {
    url = PROCESS_ENV.ZITADEL_URL ?? "http://localhost:8080",
    projectId = PROCESS_ENV.ZITADEL_PROJECT_ID || PROCESS_ENV.VITE_ZITADEL_PROJECT_ID,
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
    projectSecret = PROCESS_ENV.ZITADEL_PROJECT_SECRET,
  } = options;

  // Guard against open-redirect: loginPath must be a relative path.
  if (!loginPath.startsWith("/") || loginPath.startsWith("//")) {
    throw new Error(
      `[nextgen] loginPath must be a relative path starting with a single "/". ` +
        `Received: "${loginPath}". Using an absolute or protocol-relative URL ` +
        `would allow open-redirect attacks.`,
    );
  }

  const onRequest = async (event: SolidFetchEvent): Promise<Response | undefined> => {
    const url2 = new URL(event.request.url);
    const { pathname } = url2;

    // Clients never send x-nextgen-auth-token: it is an internal channel. Refuse any
    // request that carries it, on every route, before anything else runs.
    if (event.request.headers.has("x-nextgen-auth-token")) {
      return new Response("Bad Request", { status: 400 });
    }

    if (matchesRoutes(pathname, ignoredRoutes)) {
      return;
    }

    if (pathname === proxyPath || pathname.startsWith(`${proxyPath}/`)) {
      return proxyRequest(event, url2, url, proxyPath, projectSecret, proxyTimeoutMs);
    }

    return handleAuth(event, url2, {
      url,
      projectId,
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

  return { onRequest: [onRequest] };
}

/**
 * Reads the auth state from a SolidStart `FetchEvent` after the middleware has
 * run. Inside a server function or route, obtain the event via
 * `getRequestEvent()` from `solid-js/web`.
 *
 * ```ts
 * import { getRequestEvent } from "solid-js/web";
 * import { getAuth } from "@zitadel/sdk-solid-start/server";
 *
 * const auth = getAuth(getRequestEvent()!);
 * ```
 *
 * @param event - The current SolidStart request event.
 * @returns The current {@link AuthResult}.
 */
export function getAuth(event: SolidFetchEvent): AuthResult {
  return event.locals.nextgenAuth ?? { isAuthenticated: false, session: null };
}
