import type { ZitadelProject } from '@zitadel-nextgen/api/config';
import type { NextgenMiddlewareOptions } from '@zitadel-nextgen/sdk-core/types';
import type { NextRequest } from 'next/server';

import {
  HOP_BY_HOP,
  INTERNAL_HEADERS,
  filterResponseHeaders,
  matchesRoutes,
} from '@zitadel-nextgen/sdk-core/middleware';
import { NextResponse } from 'next/server';

import { verifyJwt } from './lib/jwt';

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

  // Security: strip any x-middleware-override-headers the client may have sent.
  // Preserving the client value would allow an attacker to inject arbitrary
  // header names into the Next.js override list, potentially bypassing the
  // internal header-tunnelling safety checks. We always build this header from
  // scratch using only the names we inject ourselves.
  headers.delete('x-middleware-override-headers');

  const injectedNames = [];

  for (const [name, value] of Object.entries(extra)) {
    headers.set(name, value);
    headers.set(`x-middleware-request-${name}`, value);
    injectedNames.push(name);
  }

  headers.set('x-middleware-override-headers', injectedNames.join(','));
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
    allowedAlgorithms = ['RS256', 'ES256'] as const,
    clockSkewMs = 5000,
    audience,
    allowedTokenTypes = ['JWT', 'at+JWT'],
    jwksTimeoutMs,
    proxyTimeoutMs = 5000,
    onExchangeResponse,
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

  const { pathname } = new URL(req.url);

  if (matchesRoutes(pathname, ignoredRoutes)) {
    // Neutralise any client-supplied x-nextgen-auth-token on ignored routes.
    // handleAuth is skipped for ignored routes, so we must strip the header
    // here to prevent a forged value from reaching server components.
    const headers = tunnelHeaders(req, { 'x-nextgen-auth-token': '' });
    return NextResponse.next({ request: { headers } });
  }

  if (pathname === proxyPath || pathname.startsWith(`${proxyPath}/`)) {
    return proxyRequest(
      req,
      issuerUrl,
      proxyPath,
      proxyTimeoutMs,
      onExchangeResponse,
    );
  }

  return handleAuth(req, {
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
  proxyTimeoutMs: number,
  onExchangeResponse?: (response: Response) => Response | Promise<Response>,
): Promise<Response> {
  const url = new URL(req.url);
  const suffix = url.pathname.slice(proxyPath.length);
  const target = `${issuerUrl}${suffix}${url.search}`;

  const upstreamHeaders = new Headers();
  for (const [key, value] of req.headers.entries()) {
    const lower = key.toLowerCase();
    if (!HOP_BY_HOP.has(lower) && !INTERNAL_HEADERS.has(lower)) {
      upstreamHeaders.set(key, value);
    }
  }

  // Always append the direct client IP to the X-Forwarded-For chain so the
  // upstream auth server sees the full proxy path. We never skip this even when
  // a chain is already present — a CDN or load balancer may have set XFF before
  // the request reached this edge node, and our hop must still be recorded.
  const directIp =
    (req as unknown as { ip?: string }).ip ?? req.headers.get('x-real-ip');
  if (directIp) {
    const existingXff = upstreamHeaders.get('x-forwarded-for');
    upstreamHeaders.set(
      'x-forwarded-for',
      existingXff ? `${existingXff}, ${directIp}` : directIp,
    );
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
    signal: AbortSignal.timeout(proxyTimeoutMs),
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit);

  const responseHeaders = filterResponseHeaders(upstream.headers);

  const setCookies = upstream.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookies) {
    responseHeaders.append('set-cookie', cookie);
  }

  let response = new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });

  // Call the exchange hook when the proxied request is POST /sessions/exchange.
  const isExchange =
    req.method === 'POST' && suffix.startsWith('/sessions/exchange');
  if (isExchange && onExchangeResponse) {
    response = await onExchangeResponse(response);
  }

  return response;
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
    jwksTimeoutMs,
    pathname,
  } = opts;

  const authHeader = req.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;
  const cookieToken = req.cookies.get('__nextgen_session')?.value ?? null;
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
    const tunnelled = tunnelHeaders(req, { 'x-nextgen-auth-token': token });
    return NextResponse.next({ request: { headers: tunnelled } });
  }

  const tunnelled = tunnelHeaders(req, { 'x-nextgen-auth-token': '' });
  const staleNextgenCookies = req.cookies
    .getAll()
    .filter((c: { name: string }) => c.name.startsWith('__nextgen'));

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

/**
 * Options for {@link createProxy} that are separate from the shared
 * {@link ZitadelConfig}. These configure route protection, login
 * redirects, and JWT verification behaviour.
 *
 * `proxyPath` and `issuerUrl` are omitted because they come from the
 * {@link ZitadelConfig} passed as the first argument.
 */
export type ProxyOptions = Omit<
  NextgenMiddlewareOptions,
  'proxyPath' | 'issuerUrl'
>;

/**
 * A pre-configured middleware handler returned by {@link createProxy}.
 */
export type ProxyHandler = (
  req: NextRequest,
) => Promise<NextResponse | Response>;

/**
 * Creates a pre-configured middleware handler from the SDK config
 * returned by `configureZitadel()`. This is the derived-service
 * derived service pattern:
 *
 * ```ts
 * // src/zitadel.ts
 * import { configureZitadel } from "@zitadel-nextgen/api/config";
 * import { createProxy } from "@zitadel-nextgen/sdk-next/middleware";
 *
 * const zitadel = configureZitadel({
 *   apiBase: "/__nextgen",
 *   projectId: "demo",
 *   issuerUrl: process.env.NEXTGEN_ISSUER_URL,
 * });
 *
 * export const proxy = createProxy(zitadel, {
 *   protectedRoutes: ["/admin*"],
 *   loginPath: "/login",
 * });
 * ```
 *
 * Then in middleware.ts:
 *
 * ```ts
 * import { proxy } from "./zitadel";
 * export const middleware = proxy;
 * ```
 *
 * @param config  - The SDK handle from `configureZitadel()`.
 * @param options - Route protection and JWT options.
 * @returns A middleware handler function.
 */
export function createProxy(
  config: ZitadelProject,
  options: ProxyOptions = {},
): ProxyHandler {
  const mergedOptions: NextgenMiddlewareOptions = {
    ...options,
    proxyPath: config.apiBase,
    issuerUrl: config.issuerUrl,
  };
  return (req: NextRequest) => nextgenMiddleware(req, mergedOptions);
}
