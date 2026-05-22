import type { EventHandler, H3Event } from 'h3';

import {
  defineEventHandler,
  getCookie,
  parseCookies,
  deleteCookie,
  sendRedirect,
  getRequestURL,
  getRequestHeader,
  readRawBody,
} from 'h3';

import type { AuthResult, NextgenMiddlewareOptions } from '../types';

import { verifyJwt } from '../lib/jwt';

declare module 'h3' {
  interface H3EventContext {
    nextgenAuth: AuthResult;
  }
}

/**
 * Headers that must never be forwarded to an upstream service.
 * These are connection-level headers that are meaningful only between
 * two directly connected peers and become invalid when proxied.
 */
const HOP_BY_HOP: ReadonlySet<string> = new Set([
  'connection',
  // host is not a hop-by-hop header per RFC 7230, but it must be stripped so
  // the fetch implementation derives the correct Host from the upstream URL
  // rather than forwarding the client's Host and causing SNI/vhost mismatches.
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/**
 * SDK-internal headers that must never be forwarded to the upstream backend.
 * These headers carry session data between the middleware and server components;
 * forwarding them upstream would expose internal state and allow header injection.
 */
const INTERNAL_HEADERS: ReadonlySet<string> = new Set(['x-nextgen-auth-token']);

/**
 * Conditionally adds the `Secure` flag to any cookie whose name starts with
 * `__nextgen`, but only when the client-facing connection is HTTPS.
 *
 * The proxy may terminate TLS — the upstream auth server cannot know whether
 * the browser-facing connection is HTTPS. When `secure` is `true` (i.e. the
 * original request arrived over HTTPS), `Secure` is added so that `__nextgen*`
 * session cookies are never sent over plain HTTP on subsequent requests. When
 * `secure` is `false` (plain HTTP), the flag is intentionally omitted: browsers
 * refuse to store cookies with `Secure` on non-TLS connections, which would
 * break the auth flow entirely.
 *
 * Non-`__nextgen*` cookies are returned unchanged. We trust the upstream for
 * `HttpOnly` and `SameSite`, which are set correctly by the auth server and
 * do not depend on whether TLS is terminated at the edge.
 *
 * @param cookie - The raw `Set-Cookie` header value.
 * @param secure - `true` when the client-facing connection is HTTPS.
 */
function upgradeSessionCookie(cookie: string, secure: boolean): string {
  const name = cookie.split('=')[0]?.trim() ?? '';
  if (!name.startsWith('__nextgen') || !secure) {
    return cookie;
  }
  // Case-insensitive check to avoid doubling an existing Secure flag.
  if (/;\s*Secure\b/i.test(cookie)) {
    return cookie;
  }
  return `${cookie}; Secure`;
}

/**
 * Returns `true` when `pathname` matches at least one entry in `routes`.
 *
 * An entry ending with `*` matches any path that starts with the prefix
 * before the `*`. All other entries require an exact match.
 *
 * @param pathname - The URL pathname to test.
 * @param routes   - The list of route patterns to match against.
 * @returns `true` if at least one pattern matches.
 */
function matchesRoutes(pathname: string, routes: readonly string[]): boolean {
  if (routes.length === 0) {
    return false;
  }
  return routes.some((pattern) => {
    if (pattern.endsWith('*')) {
      return pathname.startsWith(pattern.slice(0, -1));
    }
    return pathname === pattern;
  });
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
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }

  const url = getRequestURL(event);

  // Always append the direct socket IP to the X-Forwarded-For chain so the
  // upstream auth server sees the full proxy path. We never skip this even when
  // a chain is already present — a load balancer may have set XFF before the
  // request reached this Nitro server, and our hop must still be recorded.
  const socketIp = (
    event.node.req.socket as { remoteAddress?: string } | undefined
  )?.remoteAddress;
  if (socketIp) {
    const existingXff = headers.get('x-forwarded-for');
    headers.set(
      'x-forwarded-for',
      existingXff ? `${existingXff}, ${socketIp}` : socketIp,
    );
  }

  if (!headers.has('x-forwarded-host')) {
    headers.set('x-forwarded-host', url.host);
  }

  if (!headers.has('x-forwarded-proto')) {
    headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
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
 * import { createNextgenMiddleware } from "@zitadel-nextgen/sdk-nuxt/server";
 *
 * export default createNextgenMiddleware({
 *   issuerUrl: process.env.NEXTGEN_ISSUER_URL,
 *   protectedRoutes: ["/admin*", "/dashboard*"],
 *   loginPath: "/login",
 * });
 * ```
 *
 * @param options - Middleware configuration options.
 * @returns An H3 event handler suitable for use as a global server middleware.
 */
export function createNextgenMiddleware(
  options: NextgenMiddlewareOptions = {},
): EventHandler {
  const {
    issuerUrl = process.env.NEXTGEN_ISSUER_URL ?? 'http://localhost:4000',
    proxyPath = '/__nextgen',
    protectedRoutes = [],
    ignoredRoutes = [],
    loginPath = '/login',
    allowedAlgorithms = ['RS256', 'ES256'] as const,
    clockSkewMs = 5000,
    audience,
    allowedTokenTypes = ['JWT', 'at+JWT'],
    jwksTimeoutMs,
    proxyTimeoutMs = 5000,
  } = options;

  // Guard against open-redirect: loginPath must be a relative path. An absolute
  // URL (e.g. "https://evil.com/phish") or a protocol-relative URL
  // (e.g. "//evil.com") would redirect the browser to an external host.
  if (!loginPath.startsWith('/') || loginPath.startsWith('//')) {
    throw new Error(
      `[nextgen] loginPath must be a relative path starting with a single "/". ` +
        `Received: "${loginPath}". Using an absolute or protocol-relative URL ` +
        `would allow open-redirect attacks.`,
    );
  }

  return defineEventHandler(async (event: H3Event) => {
    const url = getRequestURL(event);
    const { pathname } = url;

    if (matchesRoutes(pathname, ignoredRoutes)) {
      // Neutralise any client-supplied x-nextgen-auth-token on ignored routes.
      // handleAuth is skipped for ignored routes, so we must strip the header
      // here to prevent a forged value from reaching downstream route handlers.
      delete (
        event.node.req.headers as Record<string, string | string[] | undefined>
      )['x-nextgen-auth-token'];
      return;
    }

    if (pathname === proxyPath || pathname.startsWith(`${proxyPath}/`)) {
      return proxyRequest(event, issuerUrl, proxyPath, url, proxyTimeoutMs);
    }

    return handleAuth(event, {
      issuerUrl,
      protectedRoutes,
      loginPath,
      allowedAlgorithms,
      clockSkewMs,
      audience,
      allowedTokenTypes,
      jwksTimeoutMs,
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
 * @param issuerUrl  - Base URL of the auth backend.
 * @param proxyPath  - The path prefix being proxied (e.g. `"/__nextgen"`).
 * @param url        - The parsed request URL.
 * @returns The upstream response body stream.
 */
async function proxyRequest(
  event: H3Event,
  issuerUrl: string,
  proxyPath: string,
  url: URL,
  proxyTimeoutMs: number,
): Promise<ReadableStream<Uint8Array> | null> {
  const suffix = url.pathname.slice(proxyPath.length);
  const target = `${issuerUrl}${suffix}${url.search}`;

  const method = event.node.req.method ?? 'GET';
  const hasBody = !['GET', 'HEAD'].includes(method);
  const rawBody = hasBody ? await readRawBody(event, false) : undefined;
  const body = rawBody != null ? new Uint8Array(rawBody) : undefined;

  const upstream = await fetch(target, {
    method,
    headers: buildUpstreamHeaders(event),
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(proxyTimeoutMs),
  });

  event.node.res.statusCode = upstream.status;

  for (const [key, value] of upstream.headers.entries()) {
    if (
      !HOP_BY_HOP.has(key.toLowerCase()) &&
      key.toLowerCase() !== 'set-cookie' &&
      // location is stripped to prevent leaking internal upstream URLs to the
      // browser — this proxy is a pure API proxy and never issues redirects.
      key.toLowerCase() !== 'location'
    ) {
      event.node.res.setHeader(key, value);
    }
  }

  const proto =
    getRequestHeader(event, 'x-forwarded-proto') ??
    url.protocol.replace(':', '');
  const isSecure = proto === 'https';
  const setCookieHeaders = upstream.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookieHeaders) {
    event.node.res.appendHeader(
      'set-cookie',
      upgradeSessionCookie(cookie, isSecure),
    );
  }

  return upstream.body;
}

/**
 * Options passed internally to {@link handleAuth} after destructuring the
 * public-facing {@link NextgenMiddlewareOptions}.
 */
interface AuthHandlerOptions {
  readonly issuerUrl: string;
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
async function handleAuth(
  event: H3Event,
  opts: AuthHandlerOptions,
): Promise<void> {
  const {
    issuerUrl,
    protectedRoutes,
    loginPath,
    allowedAlgorithms,
    clockSkewMs,
    audience,
    allowedTokenTypes,
    jwksTimeoutMs,
    pathname,
  } = opts;

  // Strip any client-supplied x-nextgen-auth-token from the inbound request so
  // route handlers cannot observe an attacker-controlled value by reading the
  // raw request headers. The canonical auth state is event.context.nextgenAuth;
  // handlers should call getAuth(event) rather than reading this header directly.
  // In sdk-next the equivalent protection is provided by tunnelHeaders, which
  // always overwrites the header value via Next.js's header-override mechanism.
  delete (
    event.node.req.headers as Record<string, string | string[] | undefined>
  )['x-nextgen-auth-token'];

  const authHeader = getRequestHeader(event, 'authorization');
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;
  const cookieToken = getCookie(event, '__nextgen_session') ?? null;
  // Bearer token takes explicit precedence over the session cookie. API clients
  // (e.g. mobile apps, CLIs) use Authorization headers while browsers use
  // cookies; when both are present the caller clearly intended the Bearer token.
  const token = bearerToken ?? cookieToken;

  const payload = token
    ? await verifyJwt(token, {
        issuerUrl,
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
        email: payload.email ?? null,
        name: payload.name ?? null,
        token,
      },
    };
    return;
  }

  event.context.nextgenAuth = { isAuthenticated: false, session: null };

  for (const name of Object.keys(parseCookies(event))) {
    if (name.startsWith('__nextgen')) {
      deleteCookie(event, name);
    }
  }

  if (matchesRoutes(pathname, protectedRoutes)) {
    const loginUrl = new URL(loginPath, getRequestURL(event));
    loginUrl.searchParams.set('next', pathname);
    await sendRedirect(event, loginUrl.toString(), 302);
  }
}

/**
 * Reads the auth state from a Nitro/H3 event context.
 *
 * Call this inside any server route or API handler after the middleware has run:
 *
 * ```ts
 * import { getAuth } from "@zitadel-nextgen/sdk-nuxt/server";
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
