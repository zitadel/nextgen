import type { AuthResult, NextgenMiddlewareOptions } from "@zitadel/sdk-core/middleware";
import type { EventHandler, H3Event } from "h3";

import { useRuntimeConfig } from "#imports";
import {
  HOP_BY_HOP,
  INTERNAL_HEADERS,
  filterResponseHeaders,
  matchesRoutes,
} from "@zitadel/sdk-core/middleware";
import {
  defineEventHandler,
  getCookie,
  parseCookies,
  deleteCookie,
  sendRedirect,
  getRequestURL,
  getRequestHeader,
  readRawBody,
} from "h3";

import { verifyJwt, base64UrlDecode } from "../lib/jwt";

declare module "h3" {
  interface H3EventContext {
    nextgenAuth: AuthResult;
  }
}

/**
 * Builds the set of upstream request headers by copying all incoming headers,
 * dropping hop-by-hop headers, and setting `X-Forwarded-*` headers so the
 * upstream auth server can see the real client origin.
 *
 * All non-hop-by-hop headers from the incoming request are forwarded as-is,
 * including any `X-Forwarded-For` chain already set by an upstream CDN or load
 * balancer. When `X-Forwarded-For` is absent (direct connection with no upstream
 * proxy), it is initialised from the raw socket address so the auth server always
 * receives origin information. `X-Forwarded-Host` and `X-Forwarded-Proto` are set
 * only when absent, preserving values injected by an upstream CDN.
 *
 * Node.js header values may be a string or an array of strings; arrays are
 * joined with `", "` to produce a single header value.
 *
 * @param event - The current H3 event.
 * @returns A `Headers` instance safe to forward to the upstream service.
 */
function buildUpstreamHeaders(event: H3Event): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(event.node.req.headers)) {
    const lower = key.toLowerCase();
    if (!value || HOP_BY_HOP.has(lower) || INTERNAL_HEADERS.has(lower)) {
      continue;
    }
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  const url = getRequestURL(event);

  // Always append the direct socket IP to the X-Forwarded-For chain so the
  // upstream auth server sees the full proxy path. We never skip this even when
  // a chain is already present — a load balancer may have set XFF before the
  // request reached this Nitro server, and our hop must still be recorded.
  const socketIp = (event.node.req.socket as { remoteAddress?: string } | undefined)?.remoteAddress;
  if (socketIp) {
    const existingXff = headers.get("x-forwarded-for");
    headers.set("x-forwarded-for", existingXff ? `${existingXff}, ${socketIp}` : socketIp);
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
 * Creates an H3 event handler that handles proxying, JWT verification, and
 * route protection in a single pass.
 *
 * Register it as a Nitro server middleware in `server/middleware/auth.ts`:
 *
 * ```ts
 * import { createNextgenMiddleware } from "@zitadel/sdk-nuxt/server";
 *
 * export default createNextgenMiddleware({
 *   url: process.env.ZITADEL_URL,
 *   protectedRoutes: ["/admin*", "/dashboard*"],
 *   loginPath: "/login",
 * });
 * ```
 *
 * @param options - Middleware configuration options.
 * @returns An H3 event handler suitable for use as a global server middleware.
 */
export function createNextgenMiddleware(options: NextgenMiddlewareOptions = {}): EventHandler {
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
  } = options;

  // Guard against open-redirect: loginPath must be a relative path. An absolute
  // URL (e.g. "https://evil.com/phish") or a protocol-relative URL
  // (e.g. "//evil.com") would redirect the browser to an external host.
  if (!loginPath.startsWith("/") || loginPath.startsWith("//")) {
    throw new Error(
      `[nextgen] loginPath must be a relative path starting with a single "/". ` +
        `Received: "${loginPath}". Using an absolute or protocol-relative URL ` +
        `would allow open-redirect attacks.`,
    );
  }

  return defineEventHandler(async (event: H3Event) => {
    const urlObj = getRequestURL(event);
    const { pathname } = urlObj;

    if (matchesRoutes(pathname, ignoredRoutes)) {
      // Neutralise any client-supplied x-nextgen-auth-token on ignored routes.
      // handleAuth is skipped for ignored routes, so we must strip the header
      // here to prevent a forged value from reaching downstream route handlers.
      delete (event.node.req.headers as Record<string, string | string[] | undefined>)[
        "x-nextgen-auth-token"
      ];
      return;
    }

    if (pathname === proxyPath || pathname.startsWith(`${proxyPath}/`)) {
      return proxyRequest(event, url, proxyPath, urlObj, proxyTimeoutMs);
    }

    return handleAuth(event, {
      url,
      protectedRoutes,
      loginPath,
      allowedAlgorithms,
      clockSkewMs,
      audience,
      allowedTokenTypes,
      jwksTimeoutMs,
      opaqueTokenTimeoutMs,
      pathname,
    });
  });
}

/**
 * Forwards a `/__nextgen/*` request to the upstream auth backend and streams
 * the response back verbatim, including `Set-Cookie` headers.
 * Hop-by-hop headers are stripped in both directions.
 *
 * @param event      - The current H3 event.
 * @param authUrl    - Base URL of the auth backend.
 * @param proxyPath  - The path prefix being proxied (e.g. `"/__nextgen"`).
 * @param url        - The parsed request URL.
 * @returns The upstream response body stream.
 */
async function proxyRequest(
  event: H3Event,
  authUrl: string,
  proxyPath: string,
  url: URL,
  proxyTimeoutMs: number,
): Promise<ReadableStream<Uint8Array> | null> {
  const suffix = url.pathname.slice(proxyPath.length);
  const target = `${authUrl}${suffix}${url.search}`;

  const method = event.node.req.method ?? "GET";
  const hasBody = !["GET", "HEAD"].includes(method);
  const rawBody = hasBody ? await readRawBody(event, false) : undefined;
  const body = rawBody != null ? new Uint8Array(rawBody) : undefined;

  const upstreamHeaders = buildUpstreamHeaders(event);

  // ADR 036: the current browser flow needs the confidential project secret
  // only for the handoff exchange. Never make the public proxy an
  // operator-capable relay, and preserve an explicit caller credential for
  // the future publishable-key exchange path.
  if (requiresProjectSecret(method, suffix) && !upstreamHeaders.has("authorization")) {
    const config = useRuntimeConfig();
    const projectSecret = (config.nextgen as { projectSecret?: string } | undefined)?.projectSecret;
    if (projectSecret) {
      upstreamHeaders.set("authorization", `Bearer ${projectSecret}`);
    }
  }

  const upstream = await fetch(target, {
    method,
    headers: upstreamHeaders,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(proxyTimeoutMs),
  });

  // Build a web-standard Response with filtered headers. This is the
  // canonical representation — we write it to event.node.res at the end.
  const responseHeaders = filterResponseHeaders(upstream.headers);

  const setCookieHeaders = upstream.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookieHeaders) {
    responseHeaders.append("set-cookie", cookie);
  }

  const response = new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });

  // Write the response to the H3 event.
  event.node.res.statusCode = response.status;
  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase() === "set-cookie") continue;
    event.node.res.setHeader(key, value);
  }
  // Use getSetCookie() so multiple Set-Cookie values aren't collapsed.
  const finalCookies = response.headers.getSetCookie?.() ?? [];
  for (const cookie of finalCookies) {
    event.node.res.appendHeader("set-cookie", cookie);
  }

  return response.body;
}

function requiresProjectSecret(method: string, pathname: string): boolean {
  return method.toUpperCase() === "POST" && pathname === "/sessions/exchange";
}

const DECODER = new TextDecoder();

/**
 * Returns `true` when `token` looks structurally like a signed JWT (JWS) —
 * NOT an encrypted token (JWE).
 *
 * JWS compact: 3 dot-separated segments; header has `alg` but NOT `enc`.
 * JWE compact: 5 dot-separated segments; header has BOTH `alg` and `enc`.
 *
 * Our backend issues JWE tokens (AES-256-GCM via go-jose `A256GCMKW/A256GCM`),
 * whose compact form is `header.encrypted_key.iv.ciphertext.tag`. The header
 * decodes to JSON with `"alg":"A256GCMKW","enc":"A256GCM"`. Checking for the
 * absence of `enc` correctly identifies signed JWTs without false-positives on
 * JWE tokens.
 *
 * This is a structural check only — not a security check.
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
 * Validates an opaque (non-JWT) session token by calling the backend's
 * `/sessions/me` endpoint. Returns the response JSON when the backend
 * confirms the session is live (HTTP 200), `null` otherwise.
 *
 * This is the fallback path for backends that issue encrypted opaque tokens
 * rather than self-contained JWTs.
 */
async function validateOpaqueSessionToken(
  token: string,
  issuerUrl: string,
  timeoutMs: number,
): Promise<{
  userId?: string;
  identifier: string | null;
  identifierProperty: string | null;
  display: string | null;
} | null> {
  try {
    const res = await fetch(`${issuerUrl}/sessions/me`, {
      method: "GET",
      headers: { cookie: `__nextgen_session=${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      user_id?: string;
      user?: { identifier?: string; identifier_property?: string; display?: string };
    };
    return {
      userId: body.user_id,
      identifier: body.user?.identifier ?? null,
      identifierProperty: body.user?.identifier_property ?? null,
      display: body.user?.display ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Options passed internally to {@link handleAuth} after destructuring the
 * public-facing {@link NextgenMiddlewareOptions}.
 */
interface AuthHandlerOptions {
  readonly url: string;
  readonly protectedRoutes: readonly string[];
  readonly loginPath: string;
  /**
   * Forwarded from {@link NextgenMiddlewareOptions.allowedAlgorithms}.
   * Declared as `readonly string[]` to match the {@link VerifyJwtOptions}
   * contract and prevent accidental mutation between option destructuring
   * and JWT verification.
   */
  readonly allowedAlgorithms: readonly string[] | undefined;
  readonly clockSkewMs: number;
  /**
   * Forwarded from {@link NextgenMiddlewareOptions.audience}.
   * Declared as `readonly string[]` to match the {@link VerifyJwtOptions}
   * contract.
   */
  readonly audience: string | readonly string[] | undefined;
  /**
   * Forwarded from {@link NextgenMiddlewareOptions.allowedTokenTypes}.
   * Declared as `readonly string[]` to match the {@link VerifyJwtOptions}
   * contract and prevent accidental mutation between option destructuring
   * and JWT verification.
   */
  readonly allowedTokenTypes: readonly string[];
  readonly jwksTimeoutMs: number | undefined;
  readonly opaqueTokenTimeoutMs: number;
  readonly pathname: string;
}

/**
 * Verifies the session token and writes the auth result to `event.context`.
 * Deletes all `__nextgen*` cookies when the token is present but invalid.
 * Redirects to the login page on protected routes with no valid session.
 *
 * @param event - The current H3 event.
 * @param opts  - Auth handler options.
 */
async function handleAuth(event: H3Event, opts: AuthHandlerOptions): Promise<void> {
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
    pathname,
  } = opts;

  // Strip any client-supplied x-nextgen-auth-token from the inbound request so
  // route handlers cannot observe an attacker-controlled value by reading the
  // raw request headers. The canonical auth state is event.context.nextgenAuth;
  // handlers should call getAuth(event) rather than reading this header directly.
  // In sdk-next the equivalent protection is provided by tunnelHeaders, which
  // always overwrites the header value via Next.js's header-override mechanism.
  delete (event.node.req.headers as Record<string, string | string[] | undefined>)[
    "x-nextgen-auth-token"
  ];

  const authHeader = getRequestHeader(event, "authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const cookieToken = getCookie(event, "__nextgen_session") ?? null;
  // Bearer token takes explicit precedence over the session cookie. API clients
  // (e.g. mobile apps, CLIs) use Authorization headers while browsers use
  // cookies; when both are present the caller clearly intended the Bearer token.
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
    event.context.nextgenAuth = {
      isAuthenticated: true,
      session: {
        userId: payload.sub,
        identifier: payload.email ?? null,
        identifierProperty: null,
        display: payload.name ?? null,
        token,
      },
    };
    return;
  }

  // The backend issues opaque encrypted session tokens rather than JWTs.
  // Only fall back to /sessions/me validation when the token is definitively
  // not a JWT (non-JSON segments). A token with a valid JWT structure that
  // failed verification (bad sig, wrong typ/alg) must be rejected — never
  // accepted by a backend call that doesn't re-check the JWT claims.
  let liveAnonymousSession = false;
  if (!payload && cookieToken && !isJwtShaped(cookieToken)) {
    const opaqueResult = await validateOpaqueSessionToken(cookieToken, url, opaqueTokenTimeoutMs);
    // A session without a user id is an anonymous session — the flow has not
    // verified a user factor yet. Treat it as unauthenticated rather than
    // inventing a placeholder identity that no route handler can resolve.
    if (opaqueResult?.userId) {
      event.context.nextgenAuth = {
        isAuthenticated: true,
        session: {
          userId: opaqueResult.userId,
          identifier: opaqueResult.identifier,
          identifierProperty: opaqueResult.identifierProperty,
          display: opaqueResult.display,
          token: cookieToken,
        },
      };
      return;
    }
    liveAnonymousSession = opaqueResult !== null;
  }

  event.context.nextgenAuth = { isAuthenticated: false, session: null };

  // Clearing cookies stops the browser from replaying dead credentials. A
  // live anonymous session is not dead — the backend confirmed it above, and
  // an in-progress login flow may still complete it — so its cookie stays.
  if (!liveAnonymousSession) {
    for (const name of Object.keys(parseCookies(event))) {
      if (name.startsWith("__nextgen")) {
        deleteCookie(event, name);
      }
    }
  }

  if (matchesRoutes(pathname, protectedRoutes)) {
    const loginUrl = new URL(loginPath, getRequestURL(event));
    loginUrl.searchParams.set("next", pathname);
    await sendRedirect(event, loginUrl.toString(), 302);
    return;
  }
}

/**
 * Reads the auth state from a Nitro/H3 event context.
 *
 * Call this inside any server route or API handler after the middleware has run:
 *
 * ```ts
 * import { getAuth } from "@zitadel/sdk-nuxt/server";
 *
 * export default defineEventHandler((event) => {
 *   const auth = getAuth(event);
 *   if (!auth.isAuthenticated) throw createError({ statusCode: 401 });
 *   return { userId: auth.session.userId };
 * });
 * ```
 *
 * @param event - The current H3 event.
 * @returns The current {@link AuthResult}.
 */
export function getAuth(event: H3Event): AuthResult {
  return event.context.nextgenAuth ?? { isAuthenticated: false, session: null };
}
