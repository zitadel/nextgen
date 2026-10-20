import type { ZitadelProject } from "@zitadel/api/config";
import type { NextgenMiddlewareOptions, ResolveSessionOptions } from "@zitadel/sdk-core/middleware";
import type { NextRequest } from "next/server";

import {
  HOP_BY_HOP,
  INTERNAL_HEADERS,
  filterResponseHeaders,
  loginRedirectUrl,
  matchesRoutes,
  normalizeBackendUrl,
  proxySessionCookies,
  requiresProjectSecret,
  resolveSession,
  serializeSessionCookie,
} from "@zitadel/sdk-core/middleware";
import { NextResponse } from "next/server";

/**
 * Clones the incoming request headers, injects `extra` key/value pairs,
 * and registers them with the Next.js header-tunnelling mechanism so that
 * server components can read them via `headers()`.
 *
 * @param req   - The incoming edge request.
 * @param extra - Additional headers to inject (e.g. `x-nextgen-auth-token`).
 * @returns A new `Headers` instance with the injected values registered.
 */
function tunnelHeaders(req: NextRequest, extra: Readonly<Record<string, string>>): Headers {
  const headers = new Headers(req.headers);

  // Security: strip any x-middleware-override-headers the client may have sent.
  // Preserving the client value would allow an attacker to inject arbitrary
  // header names into the Next.js override list, potentially bypassing the
  // internal header-tunnelling safety checks. We always build this header from
  // scratch using only the names we inject ourselves.
  headers.delete("x-middleware-override-headers");

  const injectedNames = [];

  // This is the only writer of x-nextgen-auth-token: it injects the verified
  // value for server components, and a client-sent one never reaches here.
  for (const [name, value] of Object.entries(extra)) {
    headers.set(name, value);
    headers.set(`x-middleware-request-${name}`, value);
    injectedNames.push(name);
  }

  headers.set("x-middleware-override-headers", injectedNames.join(","));
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
 *     url: process.env.ZITADEL_URL,
 *     protectedRoutes: ["/profile"],
 *     loginPath: "/login",
 *   });
 * }
 *
 * A session counts only in the app's own project: `projectId`, else
 * `ZITADEL_PROJECT_ID`, else `NEXT_PUBLIC_ZITADEL_PROJECT_ID`.
 *
 * export const config = {
 *   matcher: ["/__nextgen/:path*", "/profile/:path*"],
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
    url: configuredUrl = process.env.ZITADEL_URL ?? "http://localhost:8080",
    projectId = process.env.ZITADEL_PROJECT_ID || process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID,
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
  const url = normalizeBackendUrl(configuredUrl);

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

  // Clients never send x-nextgen-auth-token: it is an internal channel. Refuse any
  // request that carries it, on every route, before anything else runs.
  if (req.headers.has("x-nextgen-auth-token")) {
    return new Response("Bad Request", { status: 400 });
  }

  const { pathname } = new URL(req.url);

  if (matchesRoutes(pathname, ignoredRoutes)) {
    return NextResponse.next();
  }

  if (pathname === proxyPath || pathname.startsWith(`${proxyPath}/`)) {
    return proxyRequest(req, url, proxyPath, projectId, proxyTimeoutMs);
  }

  return handleAuth(req, {
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
    pathname,
  });
}

/**
 * Forwards a `/__nextgen/*` request to the upstream auth backend and streams
 * the response back, stripping hop-by-hop headers in both directions. The
 * session cookie travels under this project's name in the browser and the
 * server's name upstream ({@link proxySessionCookies}).
 *
 * All non-hop-by-hop headers from the incoming request are forwarded, including
 * any `X-Forwarded-For` chain already set by an upstream CDN or load balancer.
 * When `X-Forwarded-For` is absent (direct connection with no upstream proxy),
 * it is initialised from the runtime-provided client IP so the auth server
 * always receives origin information. `X-Forwarded-Host` and `X-Forwarded-Proto`
 * are set only when absent, preserving values injected by an upstream CDN.
 *
 * @param req        - The incoming edge request.
 * @param authUrl    - Base URL of the auth backend.
 * @param proxyPath  - The path prefix being proxied (e.g. `"/__nextgen"`).
 * @param projectId  - The project this app signs its users in to.
 * @returns The proxied upstream `Response`.
 */
async function proxyRequest(
  req: NextRequest,
  authUrl: string,
  proxyPath: string,
  projectId: string | undefined,
  proxyTimeoutMs: number,
): Promise<Response> {
  const url = new URL(req.url);
  const suffix = url.pathname.slice(proxyPath.length);
  const target = `${authUrl}${suffix}${url.search}`;

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
  const directIp = (req as unknown as { ip?: string }).ip;
  if (directIp) {
    const existingXff = upstreamHeaders.get("x-forwarded-for");
    upstreamHeaders.set("x-forwarded-for", existingXff ? `${existingXff}, ${directIp}` : directIp);
  }

  if (!upstreamHeaders.has("x-forwarded-host")) {
    upstreamHeaders.set("x-forwarded-host", url.host);
  }

  if (!upstreamHeaders.has("x-forwarded-proto")) {
    upstreamHeaders.set("x-forwarded-proto", url.protocol.replace(":", ""));
  }

  const sessionCookies = proxySessionCookies(
    {
      method: req.method,
      path: suffix,
      search: url.search,
      cookie: req.headers.get("cookie"),
      requestUrl: url,
    },
    projectId,
  );
  if (sessionCookies.upstreamCookie === null) {
    upstreamHeaders.delete("cookie");
  } else {
    upstreamHeaders.set("cookie", sessionCookies.upstreamCookie);
  }

  const hasBody = !["GET", "HEAD"].includes(req.method);

  // ADR 036: the current browser flow needs the confidential project secret
  // only for the handoff exchange. Stamping it onto every proxied operation
  // turns this public request boundary into an operator-capable open relay.
  // Preserve an explicit caller credential so the exchange can use the future
  // publishable-key plane without being overwritten.
  if (requiresProjectSecret(req.method, suffix) && !upstreamHeaders.has("authorization")) {
    const secret = process.env.ZITADEL_PROJECT_SECRET;
    if (secret) {
      upstreamHeaders.set("authorization", `Bearer ${secret}`);
    }
  }

  // Read body eagerly so undici receives a concrete buffer rather than a
  // WinterCG ReadableStream, which is incompatible with Node.js fetch body
  // extraction.
  const bodyBuffer = hasBody ? await req.arrayBuffer() : undefined;

  const upstream = await fetch(target, {
    method: req.method,
    headers: upstreamHeaders,
    body: bodyBuffer,
    redirect: "manual",
    signal: AbortSignal.timeout(proxyTimeoutMs),
  });

  // The app's own request URL: the origin a proxied redirect may name, and
  // the base a relative one resolves against.
  const responseHeaders = filterResponseHeaders(upstream.headers, req.nextUrl.toString());

  const answer = await sessionCookies.toBrowser(upstream);
  for (const cookie of answer.setCookies) {
    responseHeaders.append("set-cookie", cookie);
  }

  return new Response(answer.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

/**
 * Options passed internally to {@link handleAuth} after destructuring the
 * public-facing {@link NextgenMiddlewareOptions}: the route policy, plus what
 * the shared {@link resolveSession} judges the session by.
 */
interface AuthHandlerOptions extends ResolveSessionOptions {
  readonly protectedRoutes: readonly string[];
  readonly loginPath: string;
  readonly pathname: string;
}

/**
 * Judges the session and tunnels the token of a signed-in user to server
 * components via a request header, where `auth()` verifies it again.
 * Redirects to the login page when nobody is signed in on a protected route.
 * Either way the response carries the session cookies the judgement asks for.
 * When the backend cannot say whether the session is live, a protected route
 * answers `503` instead.
 *
 * @param req  - The incoming edge request.
 * @param opts - Auth handler options.
 * @returns A `NextResponse` to continue, redirect, or answer `503`.
 */
async function handleAuth(req: NextRequest, opts: AuthHandlerOptions): Promise<NextResponse> {
  const { protectedRoutes, loginPath, pathname, ...verification } = opts;

  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const { auth, undecided, cookies } = await resolveSession(
    { bearer: bearerToken, cookie: (name) => req.cookies.get(name)?.value, requestUrl: req.url },
    verification,
  );

  let response: NextResponse;
  if (auth.isAuthenticated) {
    const tunnelled = tunnelHeaders(req, { "x-nextgen-auth-token": auth.session.token });
    response = NextResponse.next({ request: { headers: tunnelled } });
  } else if (undecided && matchesRoutes(pathname, protectedRoutes)) {
    // The backend could not say whether the session is live. The user may well
    // be signed in, so a protected route answers 503 rather than send them to
    // the login page.
    response = new NextResponse("Service Unavailable", { status: 503 });
  } else if (matchesRoutes(pathname, protectedRoutes)) {
    response = NextResponse.redirect(loginRedirectUrl(loginPath, req.url), { status: 302 });
  } else {
    const tunnelled = tunnelHeaders(req, { "x-nextgen-auth-token": "" });
    response = NextResponse.next({ request: { headers: tunnelled } });
  }

  // A dead session's cookie is cleared so the browser stops replaying it, and a
  // session of this project still under the shared name moves to the project's
  // own cookie. A live session that signs no one in here (an anonymous one, or
  // one of another project) keeps its cookie, and so does one the backend gave
  // no verdict on.
  for (const cookie of cookies) {
    response.headers.append("set-cookie", serializeSessionCookie(cookie));
  }
  return response;
}

/**
 * Options for {@link createProxy} that are separate from the shared
 * {@link ZitadelConfig}. These configure route protection, login
 * redirects, and JWT verification behaviour.
 *
 * `proxyPath` and `url` are omitted because they come from the
 * {@link ZitadelConfig} passed as the first argument.
 */
export type ProxyOptions = Omit<NextgenMiddlewareOptions, "proxyPath" | "url">;

/**
 * A pre-configured middleware handler returned by {@link createProxy}.
 */
export type ProxyHandler = (req: NextRequest) => Promise<NextResponse | Response>;

/**
 * Creates a pre-configured middleware handler from the SDK config
 * returned by `configureZitadel()`. This is the derived-service
 * derived service pattern:
 *
 * ```ts
 * // src/zitadel.ts
 * import { configureZitadel } from "@zitadel/api/config";
 * import { createProxy } from "@zitadel/sdk-next/middleware";
 *
 * const zitadel = configureZitadel({
 *   projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? "",
 *   url: process.env.ZITADEL_URL,
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
 * Sessions are held to the handle's project unless `options.projectId` names
 * another. `auth()` runs in the server runtime, where the middleware's handle
 * may not be configured: it reads `ZITADEL_PROJECT_ID` /
 * `NEXT_PUBLIC_ZITADEL_PROJECT_ID`, else a handle configured there. When the
 * project lives only in this handle, pass it as `auth({ projectId })` too.
 *
 * @param config  - The SDK handle from `configureZitadel()`.
 * @param options - Route protection and JWT options.
 * @returns A middleware handler function.
 */
export function createProxy(config: ZitadelProject, options: ProxyOptions = {}): ProxyHandler {
  const mergedOptions: NextgenMiddlewareOptions = {
    ...options,
    projectId: options.projectId ?? (config.projectId || undefined),
    proxyPath: config.proxyPath,
    url: config.url,
  };
  return (req: NextRequest) => nextgenMiddleware(req, mergedOptions);
}
