import type { NextRequest } from 'next/server';

import { NextResponse } from 'next/server';

import type { NextgenMiddlewareOptions } from './types';

import { verifyJwt } from './lib/jwt';

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
 * Clones the incoming request headers, injects `extra` key/value pairs,
 * and registers them with the Next.js header-tunnelling mechanism so that
 * server components can read them via `headers()`.
 *
 * @param req   - The incoming edge request.
 * @param extra - Additional headers to inject (e.g. `x-nextgen-auth-token`).
 * @returns A new `Headers` instance with the injected values registered.
 */
function tunnelHeaders(
  req: NextRequest,
  extra: Readonly<Record<string, string>>,
): Headers {
  const headers = new Headers(req.headers);
  const injectedNames: string[] = [];

  for (const [name, value] of Object.entries(extra)) {
    headers.set(name, value);
    headers.set(`x-middleware-request-${name}`, value);
    injectedNames.push(name);
  }

  const existing = headers.get('x-middleware-override-headers') ?? '';
  const combined = existing
    ? `${existing},${injectedNames.join(',')}`
    : injectedNames.join(',');

  headers.set('x-middleware-override-headers', combined);
  return headers;
}

/**
 * Next.js Edge middleware that handles proxying, JWT verification, and route
 * protection in a single pass.
 *
 * Place this in your `middleware.ts` file:
 *
 * ```ts
 * import { nextgenMiddleware } from "@zitadel/sdk-next/middleware";
 * import type { NextRequest } from "next/server";
 *
 * export function middleware(req: NextRequest) {
 *   return nextgenMiddleware(req, {
 *     issuerUrl: process.env.NEXTGEN_ISSUER_URL,
 *     protectedRoutes: ["/admin*", "/dashboard*"],
 *     loginPath: "/login",
 *   });
 * }
 *
 * export const config = {
 *   matcher: ["/__nextgen/:path*", "/admin/:path*", "/login"],
 * };
 * ```
 *
 * @param req     - The incoming Next.js edge request.
 * @param options - Middleware configuration options.
 * @returns A `NextResponse` or `Response` to continue, redirect, or proxy.
 */
export async function nextgenMiddleware(
  req: NextRequest,
  options: NextgenMiddlewareOptions = {},
): Promise<NextResponse | Response> {
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

  const { pathname } = new URL(req.url);

  if (matchesRoutes(pathname, ignoredRoutes)) {
    return NextResponse.next();
  }

  if (pathname.startsWith(proxyPath)) {
    return proxyRequest(req, issuerUrl, proxyPath);
  }

  return handleAuth(req, {
    issuerUrl,
    protectedRoutes,
    loginPath,
    allowedAlgorithms,
    clockSkewMs,
    audience,
    allowedTokenTypes,
    pathname,
  });
}

/**
 * Forwards a `/__nextgen/*` request to the upstream auth backend and streams
 * the response back verbatim, stripping hop-by-hop headers in both directions.
 *
 * All non-hop-by-hop headers from the incoming request are forwarded, including
 * any `X-Forwarded-For` chain already set by an upstream CDN or load balancer.
 * When `X-Forwarded-For` is absent (direct connection with no upstream proxy),
 * it is initialised from the runtime-provided client IP so the auth server
 * always receives origin information. `X-Forwarded-Host` and `X-Forwarded-Proto`
 * are set only when absent, preserving values injected by an upstream CDN.
 *
 * @param req        - The incoming edge request.
 * @param issuerUrl  - Base URL of the auth backend.
 * @param proxyPath  - The path prefix being proxied (e.g. `"/__nextgen"`).
 * @returns The proxied upstream `Response`.
 */
async function proxyRequest(
  req: NextRequest,
  issuerUrl: string,
  proxyPath: string,
): Promise<Response> {
  const url = new URL(req.url);
  const suffix = url.pathname.slice(proxyPath.length);
  const target = `${issuerUrl}${suffix}${url.search}`;

  const upstreamHeaders = new Headers();
  for (const [key, value] of req.headers.entries()) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      upstreamHeaders.set(key, value);
    }
  }

  if (!upstreamHeaders.has('x-forwarded-for')) {
    const directIp =
      (req as unknown as { ip?: string }).ip ?? req.headers.get('x-real-ip');
    if (directIp) {
      upstreamHeaders.set('x-forwarded-for', directIp);
    }
  }

  if (!upstreamHeaders.has('x-forwarded-host')) {
    upstreamHeaders.set('x-forwarded-host', url.host);
  }

  if (!upstreamHeaders.has('x-forwarded-proto')) {
    upstreamHeaders.set('x-forwarded-proto', url.protocol.replace(':', ''));
  }

  const hasBody = !['GET', 'HEAD'].includes(req.method);

  const upstream = await fetch(target, {
    method: req.method,
    headers: upstreamHeaders,
    body: hasBody ? req.body : undefined,
    redirect: 'manual',
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit);

  const responseHeaders = new Headers();
  for (const [key, value] of upstream.headers.entries()) {
    if (
      !HOP_BY_HOP.has(key.toLowerCase()) &&
      key.toLowerCase() !== 'set-cookie'
    ) {
      responseHeaders.set(key, value);
    }
  }

  const setCookies = upstream.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookies) {
    responseHeaders.append('set-cookie', cookie);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
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
  readonly pathname: string;
}

/**
 * Verifies the session token and tunnels the result to server components via
 * a request header. Redirects to the login page when the token is absent or
 * invalid on a protected route.
 *
 * @param req  - The incoming edge request.
 * @param opts - Auth handler options.
 * @returns A `NextResponse` to continue or redirect.
 */
async function handleAuth(
  req: NextRequest,
  opts: AuthHandlerOptions,
): Promise<NextResponse> {
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

  const authHeader = req.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;
  const cookieToken = req.cookies.get('__nextgen_session')?.value ?? null;
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
    const tunnelled = tunnelHeaders(req, { 'x-nextgen-auth-token': token });
    return NextResponse.next({ request: { headers: tunnelled } });
  }

  const tunnelled = tunnelHeaders(req, { 'x-nextgen-auth-token': '' });
  const staleNextgenCookies = req.cookies
    .getAll()
    .filter((c) => c.name.startsWith('__nextgen'));

  if (matchesRoutes(pathname, protectedRoutes)) {
    const loginUrl = new URL(loginPath, req.url);
    loginUrl.searchParams.set('next', pathname);
    const redirect = NextResponse.redirect(loginUrl, { status: 302 });
    for (const cookie of staleNextgenCookies) {
      redirect.cookies.delete(cookie.name);
    }
    return redirect;
  }

  const response = NextResponse.next({ request: { headers: tunnelled } });
  for (const cookie of staleNextgenCookies) {
    response.cookies.delete(cookie.name);
  }
  return response;
}
