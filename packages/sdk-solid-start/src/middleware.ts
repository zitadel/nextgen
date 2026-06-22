import type { AuthResult, NextgenMiddlewareOptions } from "@zitadel/sdk-core/middleware";

import {
  HOP_BY_HOP,
  INTERNAL_HEADERS,
  filterResponseHeaders,
  matchesRoutes,
} from "@zitadel/sdk-core/middleware";

import { verifyJwt, base64UrlDecode } from "./lib/jwt";

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
}

/**
 * The SolidStart middleware config object. `createNextgenMiddleware` returns
 * this directly so a consumer can `export default createNextgenMiddleware(...)`
 * from the file referenced by `middleware` in `app.config.ts` — no separate
 * `createMiddleware` call required.
 */
export interface SolidMiddlewareConfig {
  readonly onRequest: ReadonlyArray<(event: SolidFetchEvent) => Promise<Response | void>>;
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
 * upstream response verbatim, including `Set-Cookie` headers. Hop-by-hop and
 * `location` headers are stripped in both directions.
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

  // Attach the project service-key as the bearer on every proxied request. The
  // secret is read server-side and never reaches the browser — this middleware
  // runs only on the server.
  if (!upstreamHeaders.has("authorization") && projectSecret) {
    upstreamHeaders.set("authorization", `Bearer ${projectSecret}`);
  }

  const upstream = await fetch(target, {
    method,
    headers: upstreamHeaders,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(proxyTimeoutMs),
  });

  const responseHeaders = filterResponseHeaders(upstream.headers);
  const setCookies = upstream.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookies) {
    responseHeaders.append("set-cookie", cookie);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

const DECODER = new TextDecoder();

/**
 * Returns `true` when `token` looks structurally like a signed JWT (JWS) — NOT
 * an encrypted token (JWE). A structural check only, not a security check.
 */
function isJwtShaped(token: string): boolean {
  const parts = token.split(".");
  if (parts.length < 3 || !parts[0]) return false;
  try {
    const header = JSON.parse(DECODER.decode(base64UrlDecode(parts[0]))) as Record<string, unknown>;
    return typeof header?.alg === "string" && !("enc" in header);
  } catch {
    return false;
  }
}

/**
 * Validates an opaque (non-JWT) session token via the backend's `/sessions/me`
 * endpoint. Returns the response JSON on HTTP 200, `null` otherwise.
 */
async function validateOpaqueSessionToken(
  token: string,
  issuerUrl: string,
  timeoutMs: number,
): Promise<{ userId?: string } | null> {
  try {
    const res = await fetch(`${issuerUrl}/sessions/me`, {
      method: "GET",
      headers: { cookie: `__nextgen_session=${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { user_id?: string };
    return { userId: body.user_id };
  } catch {
    return null;
  }
}

/** A `Set-Cookie` value that clears `name` on the root path. */
function clearCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0`;
}

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
 * Verifies the session token, writes the auth result to `event.locals`, and
 * returns a redirect `Response` on a protected route with no valid session
 * (otherwise `undefined` to continue). Stale `__nextgen*` cookies are cleared on
 * the redirect when the token is present but invalid.
 */
async function handleAuth(
  event: SolidFetchEvent,
  url2: URL,
  opts: AuthHandlerOptions,
): Promise<Response | void> {
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
  const { pathname } = url2;

  // Strip any client-supplied x-nextgen-auth-token so downstream server code
  // cannot read an attacker-controlled value; getAuth(event) is canonical.
  try {
    event.request.headers.delete("x-nextgen-auth-token");
  } catch {
    // Immutable headers on this adapter — nothing to strip.
  }

  const cookies = parseCookieHeader(event.request.headers.get("cookie"));
  const authHeader = event.request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const cookieToken = cookies.get("__nextgen_session") ?? null;
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
    event.locals.nextgenAuth = {
      isAuthenticated: true,
      session: {
        userId: payload.sub,
        email: payload.email ?? null,
        name: payload.name ?? null,
        token,
      },
    };
    return;
  }

  if (!payload && cookieToken && !isJwtShaped(cookieToken)) {
    const opaqueResult = await validateOpaqueSessionToken(cookieToken, url, opaqueTokenTimeoutMs);
    if (opaqueResult) {
      event.locals.nextgenAuth = {
        isAuthenticated: true,
        session: {
          userId: opaqueResult.userId ?? "unknown",
          email: null,
          name: null,
          token: cookieToken,
        },
      };
      return;
    }
  }

  event.locals.nextgenAuth = { isAuthenticated: false, session: null };

  if (matchesRoutes(pathname, protectedRoutes)) {
    const loginUrl = new URL(loginPath, url2);
    loginUrl.searchParams.set("next", pathname);
    const headers = new Headers({ location: loginUrl.toString() });
    for (const name of cookies.keys()) {
      if (name.startsWith("__nextgen")) {
        headers.append("set-cookie", clearCookie(name));
      }
    }
    return new Response(null, { status: 302, headers });
  }
}

/**
 * Creates a SolidStart middleware config that handles proxying, JWT
 * verification, and route protection in a single `onRequest` pass.
 *
 * Reference it from `app.config.ts` via `middleware`, then in that file:
 *
 * ```ts
 * import { createNextgenMiddleware } from "@zitadel/sdk-solid-start/server";
 *
 * export default createNextgenMiddleware({
 *   url: process.env.ZITADEL_URL,
 *   projectSecret: process.env.ZITADEL_PROJECT_SECRET,
 *   protectedRoutes: ["/admin*", "/dashboard*"],
 *   loginPath: "/login",
 * });
 * ```
 *
 * To compose with your own handlers, spread `createNextgenMiddleware(...).onRequest`
 * into your own `createMiddleware({ onRequest: [...] })`.
 *
 * @param options - Middleware configuration. `projectSecret` is the project
 *   service-key forwarded as the bearer on proxied requests.
 * @returns A SolidStart middleware config object.
 */
export function createNextgenMiddleware(
  options: NextgenMiddlewareOptions & { projectSecret?: string } = {},
): SolidMiddlewareConfig {
  const {
    url = process.env.ZITADEL_URL ?? "http://localhost:8080",
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
    projectSecret = process.env.ZITADEL_PROJECT_SECRET,
  } = options;

  // Guard against open-redirect: loginPath must be a relative path.
  if (!loginPath.startsWith("/") || loginPath.startsWith("//")) {
    throw new Error(
      `[nextgen] loginPath must be a relative path starting with a single "/". ` +
        `Received: "${loginPath}". Using an absolute or protocol-relative URL ` +
        `would allow open-redirect attacks.`,
    );
  }

  const onRequest = async (event: SolidFetchEvent): Promise<Response | void> => {
    const url2 = new URL(event.request.url);
    const { pathname } = url2;

    if (matchesRoutes(pathname, ignoredRoutes)) {
      try {
        event.request.headers.delete("x-nextgen-auth-token");
      } catch {
        // Immutable headers on this adapter — nothing to strip.
      }
      return;
    }

    if (pathname === proxyPath || pathname.startsWith(`${proxyPath}/`)) {
      return proxyRequest(event, url2, url, proxyPath, projectSecret, proxyTimeoutMs);
    }

    return handleAuth(event, url2, {
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
