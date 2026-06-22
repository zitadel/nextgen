import type { AuthResult, NextgenMiddlewareOptions } from "@zitadel/sdk-core/middleware";

import {
  HOP_BY_HOP,
  INTERNAL_HEADERS,
  filterResponseHeaders,
  matchesRoutes,
} from "@zitadel/sdk-core/middleware";

import { verifyJwt, base64UrlDecode } from "./lib/jwt";

/**
 * The slice of Qwik City's `RequestEventCommon` this handler reads. Qwik City
 * (and Qwik 1.x, which peers Vite `>=5 <8`) is not a dependency of this package
 * — typing the handful of fields we touch keeps the package on the workspace's
 * Vite 8 toolchain while staying installable in a Qwik City app, the same way
 * `sdk-nuxt` shims Nuxt's `#imports`. The shape is structurally compatible with
 * the real `RequestEventCommon`, so the returned handler drops straight into
 * `export const onRequest = createNextgenOnRequest(...)`.
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
}

/** Parses a `Cookie` request header into a name→value map. */
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
 * upstream response verbatim, including `Set-Cookie` headers. Hop-by-hop and
 * `location` headers are stripped in both directions.
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

  // Attach the project service-key as the bearer on every proxied request. The
  // secret is read server-side and never reaches the browser.
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
 * Verifies the session token and writes the auth result to `ev.sharedMap`. On a
 * protected route with no valid session it clears stale `__nextgen*` cookies and
 * throws `ev.redirect(...)` to send the browser to the login page.
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
        email: payload.email ?? null,
        name: payload.name ?? null,
        token,
      },
    } satisfies AuthResult);
    return;
  }

  if (!payload && cookieToken && !isJwtShaped(cookieToken)) {
    const opaqueResult = await validateOpaqueSessionToken(cookieToken, url, opaqueTokenTimeoutMs);
    if (opaqueResult) {
      ev.sharedMap.set(SHARED_MAP_KEY, {
        isAuthenticated: true,
        session: {
          userId: opaqueResult.userId ?? "unknown",
          email: null,
          name: null,
          token: cookieToken,
        },
      } satisfies AuthResult);
      return;
    }
  }

  ev.sharedMap.set(SHARED_MAP_KEY, {
    isAuthenticated: false,
    session: null,
  } satisfies AuthResult);

  if (matchesRoutes(pathname, protectedRoutes)) {
    for (const name of Object.keys(ev.cookie.getAll())) {
      if (name.startsWith("__nextgen")) {
        ev.cookie.delete(name, { path: "/" });
      }
    }
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
 *   url: import.meta.env.ZITADEL_URL,
 *   projectSecret: process.env.ZITADEL_PROJECT_SECRET,
 *   protectedRoutes: ["/admin*", "/dashboard*"],
 *   loginPath: "/login",
 * });
 * ```
 *
 * @param options - Configuration. `projectSecret` is the project service-key
 *   forwarded as the bearer on proxied requests.
 * @returns A Qwik City `RequestHandler`.
 */
export function createNextgenOnRequest(
  options: NextgenMiddlewareOptions & { projectSecret?: string } = {},
): (ev: QwikRequestEvent) => Promise<void> {
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

  return async (ev: QwikRequestEvent): Promise<void> => {
    const { pathname } = ev.url;

    if (matchesRoutes(pathname, ignoredRoutes)) {
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
