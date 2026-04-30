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

import type { AuthResult, NextgenModuleOptions } from '../types';

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
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

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
    if (!value || HOP_BY_HOP.has(key.toLowerCase())) {
      continue;
    }
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }

  const url = getRequestURL(event);

  if (!headers.has('x-forwarded-for')) {
    const socketIp = (
      event.node.req.socket as { remoteAddress?: string } | undefined
    )?.remoteAddress;
    if (socketIp) {
      headers.set('x-forwarded-for', socketIp);
    }
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
 * import { createNextgenMiddleware } from "@nextgen/sdk-nuxt/server";
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
  options: NextgenModuleOptions = {},
): EventHandler {
  const {
    issuerUrl = process.env.NEXTGEN_ISSUER_URL ?? 'http://localhost:4000',
    proxyPath = '/__nextgen',
    protectedRoutes = [],
    ignoredRoutes = [],
    loginPath = '/login',
    allowedAlgorithms,
    clockSkewMs = 5000,
    audience,
    allowedTokenTypes = ['JWT', 'at+JWT'],
  } = options;

  return defineEventHandler(async (event: H3Event) => {
    const url = getRequestURL(event);
    const { pathname } = url;

    if (matchesRoutes(pathname, ignoredRoutes)) {
      return;
    }

    if (pathname.startsWith(proxyPath)) {
      return proxyRequest(event, issuerUrl, proxyPath, url);
    }

    await handleAuth(event, {
      issuerUrl,
      protectedRoutes,
      loginPath,
      allowedAlgorithms,
      clockSkewMs,
      audience,
      allowedTokenTypes,
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
  });

  event.node.res.statusCode = upstream.status;

  for (const [key, value] of upstream.headers.entries()) {
    if (
      !HOP_BY_HOP.has(key.toLowerCase()) &&
      key.toLowerCase() !== 'set-cookie'
    ) {
      event.node.res.setHeader(key, value);
    }
  }

  const setCookieHeaders = upstream.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookieHeaders) {
    event.node.res.appendHeader('set-cookie', cookie);
  }

  return upstream.body;
}

/**
 * Options passed internally to {@link handleAuth} after destructuring the
 * public-facing {@link NextgenModuleOptions}.
 */
interface AuthHandlerOptions {
  readonly issuerUrl: string;
  readonly protectedRoutes: readonly string[];
  readonly loginPath: string;
  /**
   * Forwarded from {@link NextgenModuleOptions.allowedAlgorithms}.
   * Declared as `readonly string[]` to match the {@link VerifyJwtOptions}
   * contract and prevent accidental mutation between option destructuring
   * and JWT verification.
   */
  readonly allowedAlgorithms: readonly string[] | undefined;
  readonly clockSkewMs: number;
  /**
   * Forwarded from {@link NextgenModuleOptions.audience}.
   * Declared as `readonly string[]` to match the {@link VerifyJwtOptions}
   * contract.
   */
  readonly audience: string | readonly string[] | undefined;
  /**
   * Forwarded from {@link NextgenModuleOptions.allowedTokenTypes}.
   * Declared as `readonly string[]` to match the {@link VerifyJwtOptions}
   * contract and prevent accidental mutation between option destructuring
   * and JWT verification.
   */
  readonly allowedTokenTypes: readonly string[];
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
    pathname,
  } = opts;

  const authHeader = getRequestHeader(event, 'authorization');
  const bearerToken =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const cookieToken = getCookie(event, '__nextgen_session') ?? null;
  const token = bearerToken ?? cookieToken;

  const payload = token
    ? await verifyJwt(token, {
        issuerUrl,
        allowedAlgorithms,
        clockSkewMs,
        audience,
        allowedTokenTypes,
      })
    : null;

  if (payload && token) {
    event.context.nextgenAuth = {
      isAuthenticated: true,
      session: {
        userId: payload.sub ?? '',
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
    await sendRedirect(
      event,
      `${loginPath}?next=${encodeURIComponent(pathname)}`,
      302,
    );
  }
}

/**
 * Reads the auth state from a Nitro/H3 event context.
 *
 * Call this inside any server route or API handler after the middleware has run:
 *
 * ```ts
 * import { getAuth } from "@nextgen/sdk-nuxt/server";
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
