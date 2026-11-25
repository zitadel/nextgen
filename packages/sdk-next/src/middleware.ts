/**
 * The edge middleware entry of `@zitadel/sdk-next`: it proxies `/__nextgen/*` to the Zitadel
 * backend, judges the session and protects routes.
 *
 * It uses only Web APIs (`fetch`, Web Crypto), so it runs in the Next.js edge runtime on Vercel and
 * on Cloudflare Workers, and it imports no server-only module. Import it from `proxy.ts` (or
 * `middleware.ts` on Next.js 15), never from a component. Next.js runs that file only on the routes
 * its `matcher` covers, so the `matcher` decides where this code runs at all. Use
 * {@link zitadelMiddleware} to configure it inline, or {@link createProxy} to derive it from
 * the project handle of `configureZitadel()`.
 *
 * Use Next.js 15.2.3 or later. Earlier 15.x releases skip middleware for a request that sends an
 * `x-middleware-subrequest` header, which on a self-hosted deployment would let any request past
 * the protected routes.
 *
 * @module
 */
import type { ZitadelProject } from "@zitadel/sdk-core/config";
import type {
  ProxyRoute,
  ResolveSessionOptions,
  ZitadelMiddlewareOptions,
} from "@zitadel/sdk-core/middleware";
import { joinURL } from "ufo";
import type { NextRequest } from "next/server";

import {
  HOP_BY_HOP,
  INTERNAL_HEADERS,
  filterResponseHeaders,
  loginRedirectUrl,
  matchesRoutes,
  proxyRoute,
  proxySessionCookies,
  refusedProxyResponse,
  SESSION_COOKIE_CACHE_CONTROL,
  requiresProjectSecret,
  resolveSession,
} from "@zitadel/sdk-core/middleware";
import { NextResponse } from "next/server";

/**
 * Clones the incoming request headers, injects extra headers, and registers them with the Next.js
 * header-tunnelling mechanism so that Server Components can read them through `headers()`.
 *
 * @param req - The incoming edge request.
 * @param extra - The headers to inject, for example `x-zitadel-auth-token`.
 * @returns A new `Headers` instance that carries the injected values, registered for tunnelling.
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

  // This is the only writer of x-zitadel-auth-token: it injects the session
  // token for server components, verified, or off a protected route an opaque
  // one unchecked, which auth() checks. A client-sent one never reaches here.
  for (const [name, value] of Object.entries(extra)) {
    headers.set(name, value);
    headers.set(`x-middleware-request-${name}`, value);
    injectedNames.push(name);
  }

  headers.set("x-middleware-override-headers", injectedNames.join(","));
  return headers;
}

/**
 * Handles the same-origin proxy, session verification and route protection of a Next.js app in a
 * single middleware pass.
 *
 * Call it from the `proxy.ts` file (`middleware.ts` on Next.js 15), as the app's only middleware.
 * It does three things for each request the `matcher` covers:
 *
 * - It proxies requests under `proxyPath` (default `/__nextgen`) to the Zitadel backend, so the
 *   browser, the widgets and {@link session!getSession | getSession} talk only to the app's own
 *   origin.
 * - It judges the session. A JWT is verified on every route through the JWKS, which takes no
 *   backend call. An opaque session token is checked against the backend only on a route in
 *   `protectedRoutes`, where the result decides between a redirect and a `503`. On other routes the
 *   token is handed on unchecked and {@link server!auth | auth} checks it once per render,
 *   and only on a page that reads the session, so a page that never reads it costs no backend call.
 * - It redirects a signed-out request for a protected route to `loginPath`, with the requested path
 *   and query in `?next=`, where `<zitadel-login>` returns after sign-in.
 *
 * It passes the session token to the render in the internal `x-zitadel-auth-token` request header.
 * This function is the only writer of that header. It answers `400` to any request that arrives
 * with it, on every route, before anything else runs, so a client cannot forge a session. Because
 * the `matcher` decides where it runs, a protected route that the `matcher` leaves out is never
 * redirected and stays public. Use a `matcher` that covers every route except the Next.js build
 * files, as the example does, so `protectedRoutes` is the one list that decides.
 *
 * A session counts only in the app's own project: `projectId`, else `ZITADEL_PROJECT_ID`, else
 * `NEXT_PUBLIC_ZITADEL_PROJECT_ID`. With no project, nobody is signed in. The `loginPath` must be a
 * relative path that starts with a single `/`, because anything else would redirect the browser to
 * another host, which is an open-redirect hole. The function throws when it is not. The session
 * cookie is named per project, so several apps and the Zitadel Console on one host do not sign one
 * another out.
 *
 * Protected routes and ignored routes take path patterns, with a trailing `*` as a prefix match
 * (`"/admin*"`). Routes in `ignoredRoutes` skip the middleware entirely, before the proxy.
 *
 * Naming: Next.js runs the function that middleware.ts (proxy.ts from Next.js 16) exports, with
 * each request. zitadelMiddleware(request, options) is that function: it handles the request
 * itself and returns the response. It is not a factory, so it has no create prefix.
 * createProxy(project, options) is the factory that returns a handler.
 *
 * @param req - The incoming Next.js edge request.
 * @param options - The middleware configuration; see {@link ZitadelMiddlewareOptions}.
 * @returns A response that continues the request, redirects it, answers `503` or `400`, or is the
 *   proxied backend response.
 * @throws When `options.loginPath` is not a relative path that starts with a single `/`.
 *
 * @example
 * ```ts
 * // proxy.ts (middleware.ts and `middleware` on Next.js 15).
 * import { zitadelMiddleware } from "@zitadel/sdk-next/middleware";
 * import type { NextRequest } from "next/server";
 *
 * export function proxy(req: NextRequest) {
 *   return zitadelMiddleware(req, {
 *     url: process.env.ZITADEL_URL,
 *     protectedRoutes: ["/profile", "/dashboard*"],
 *     loginPath: "/login",
 *   });
 * }
 *
 * // Every route but the Next.js build files: a protected route that the matcher leaves out
 * // never reaches the middleware and stays public.
 * export const config = {
 *   matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
 * };
 * ```
 */
export async function zitadelMiddleware(
  req: NextRequest,
  options: ZitadelMiddlewareOptions = {},
): Promise<NextResponse | Response> {
  const {
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
  const url = options.url || process.env.ZITADEL_URL || "http://localhost:8080";

  // Guard against open-redirect: loginPath must be a relative path. An absolute
  // URL (e.g. "https://evil.com/phish") or a protocol-relative URL
  // (e.g. "//evil.com") would redirect the browser to an external host.
  if (!loginPath.startsWith("/") || loginPath.startsWith("//")) {
    throw new Error(
      `[zitadel] loginPath must be a relative path starting with a single "/". ` +
        `Received: "${loginPath}". Using an absolute or protocol-relative URL ` +
        `would allow open-redirect attacks.`,
    );
  }

  // Clients never send x-zitadel-auth-token: it is an internal channel. Refuse any
  // request that carries it, on every route, before anything else runs.
  if (req.headers.has("x-zitadel-auth-token")) {
    return new Response("Bad Request", { status: 400 });
  }

  const { pathname } = new URL(req.url);

  if (matchesRoutes(pathname, ignoredRoutes)) {
    return NextResponse.next();
  }

  const route = proxyRoute(pathname, { proxyPath, projectId, loginPath });
  // An OAuth issuer that is not this app's project: the app answers, so its
  // origin never serves another project's issuer.
  if (route?.refused) {
    return refusedProxyResponse();
  }
  if (route) {
    return proxyRequest(req, url, route, projectId, proxyTimeoutMs, options.projectSecret);
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
 * Forwards a request that the proxy handles to the Zitadel backend and returns the response, with
 * hop-by-hop headers stripped in both directions. The session cookie travels under the name of this
 * project in the browser and under the name of the server upstream ({@link proxySessionCookies}).
 *
 * The session cookie travels under the project's own name in the browser and under the server's
 * name upstream, so the proxy renames it each way and never forwards another project's session
 * cookie. Every other request header is forwarded except the internal ones. The client address for
 * `X-Forwarded-For` comes only from the runtime (`req.ip`), never from a request header such as
 * `x-real-ip`, which any caller can set when the app is reachable directly. That address is
 * appended to an existing `X-Forwarded-For` chain, so a CDN's hop is kept, and is omitted when the
 * runtime provides none. `X-Forwarded-Host` and `X-Forwarded-Proto` are set only when absent, so
 * values from an upstream CDN survive. The body is read eagerly into a buffer, because a
 * streaming body is not accepted by the Node.js `fetch`. A redirect from the backend is not
 * followed: a same-origin one is passed through to the browser, and the request times out after
 * `proxyTimeoutMs`.
 *
 * It adds the project secret as a bearer token only to the session exchange, and only when the
 * caller sent no credential of its own. Adding it to every proxied operation would turn this
 * public boundary into an open relay with operator rights.
 *
 * @param req - The incoming edge request.
 * @param authUrl - The base URL of the Zitadel backend.
 * @param route - Where the request goes ({@link proxyRoute}).
 * @param projectId - The project this app signs its users in to.
 * @param proxyTimeoutMs - The time in milliseconds to wait for the backend.
 * @param projectSecretOption - The `projectSecret` option, which wins over the
 *   `ZITADEL_PROJECT_SECRET` environment variable, or `undefined` when none is set.
 * @returns The proxied upstream response.
 */
async function proxyRequest(
  req: NextRequest,
  authUrl: string,
  route: ProxyRoute,
  projectId: string | undefined,
  proxyTimeoutMs: number,
  projectSecretOption: string | undefined,
): Promise<Response> {
  const url = new URL(req.url);
  const suffix = route.path;
  const target = `${joinURL(authUrl, suffix)}${url.search}`;

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

  for (const [name, value] of Object.entries(route.headers)) {
    upstreamHeaders.set(name, value);
  }

  const sessionCookies = proxySessionCookies(
    {
      method: req.method,
      path: suffix,
      search: url.search,
      cookie: req.headers.get("cookie"),
      requestUrl: url,
      forwardedProto: req.headers.get("x-forwarded-proto"),
      forwardedHost: req.headers.get("x-forwarded-host"),
    },
    projectId,
    { url: authUrl, timeoutMs: proxyTimeoutMs },
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
    const secret = projectSecretOption || process.env.ZITADEL_PROJECT_SECRET;
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
  if (answer.setCookies.length > 0) {
    responseHeaders.set("cache-control", SESSION_COOKIE_CACHE_CONTROL);
  }

  return new Response(answer.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

/**
 * The options {@link handleAuth} receives after {@link zitadelMiddleware} destructures its
 * public options: the route policy, plus what the shared session resolver judges the session by.
 */
interface AuthHandlerOptions extends ResolveSessionOptions {
  readonly protectedRoutes: readonly string[];
  readonly loginPath: string;
  readonly pathname: string;
}

/**
 * Judges the session, tunnels its token to Server Components and applies the route policy.
 *
 * A signed-in request continues with its token in `x-zitadel-auth-token`. A signed-out request for
 * a protected route is redirected to the login page. When the backend cannot say whether an opaque
 * session is live, a protected route answers `503` instead of a redirect, because the user may well
 * be signed in. Off a protected route an opaque token is handed on unchecked, which
 * {@link server!auth | auth} verifies. Either way the response carries the cookie changes the
 * judgement asks for.
 *
 * @param req - The incoming edge request.
 * @param opts - The route policy and verification options.
 * @returns A response that continues, redirects, or answers `503`.
 */
async function handleAuth(req: NextRequest, opts: AuthHandlerOptions): Promise<NextResponse> {
  const { protectedRoutes, loginPath, pathname, ...verification } = opts;
  const isProtected = matchesRoutes(pathname, protectedRoutes);

  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const { auth, undecided, cookies, unchecked } = await resolveSession(
    {
      bearer: bearerToken,
      cookie: (name) => req.cookies.get(name)?.value,
      requestUrl: req.url,
      forwardedProto: req.headers.get("x-forwarded-proto"),
      forwardedHost: req.headers.get("x-forwarded-host"),
    },
    { ...verification, checkOpaqueSession: isProtected },
  );

  let response: NextResponse;
  if (auth.isAuthenticated) {
    const tunnelled = tunnelHeaders(req, { "x-zitadel-auth-token": auth.session.token });
    response = NextResponse.next({ request: { headers: tunnelled } });
  } else if (undecided && isProtected) {
    // The backend could not say whether the session is live. The user may well
    // be signed in, so a protected route answers 503 rather than send them to
    // the login page.
    response = new NextResponse("Service Unavailable", { status: 503 });
  } else if (isProtected) {
    response = NextResponse.redirect(loginRedirectUrl(loginPath, req.url), { status: 302 });
  } else {
    const tunnelled = tunnelHeaders(req, { "x-zitadel-auth-token": unchecked ?? "" });
    response = NextResponse.next({ request: { headers: tunnelled } });
  }

  // A dead session's cookie is cleared so the browser stops replaying it, and a
  // session of this project still under the shared name is copied to the
  // project's own cookie. A live session that signs no one in here (an
  // anonymous one, or one of another project) keeps its cookie, and so does one
  // the backend gave no verdict on, or was not asked about: off a protected
  // route, an opaque session's cookie waits for the next protected route. The
  // cookies go through the response's cookie jar, so a middleware composed
  // around this one that sets a cookie of its own through it keeps them.
  for (const cookie of cookies) {
    response.cookies.set(cookie.name, cookie.value, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: cookie.secure,
      ...(cookie.maxAge === undefined ? {} : { maxAge: cookie.maxAge }),
    });
  }
  if (cookies.length > 0) {
    response.headers.set("cache-control", SESSION_COOKIE_CACHE_CONTROL);
  }
  return response;
}

/**
 * The options of {@link createProxy}: everything in {@link ZitadelMiddlewareOptions} except
 * `proxyPath` and `url`.
 *
 * Those two come from the project handle that is the first argument of {@link createProxy}, so
 * they are omitted here to keep a single source for each. The remaining options configure route
 * protection, the login redirect and JWT verification, and have the meaning and defaults
 * documented on {@link ZitadelMiddlewareOptions}. A `projectId` given here wins over the handle's.
 *
 * @example
 * ```ts
 * import type { ProxyOptions } from "@zitadel/sdk-next/middleware";
 *
 * const options: ProxyOptions = { protectedRoutes: ["/admin*"], loginPath: "/login" };
 * ```
 */
export type ProxyOptions = Omit<ZitadelMiddlewareOptions, "proxyPath" | "url">;

/**
 * The middleware handler that {@link createProxy} returns.
 *
 * It takes the incoming request and resolves to the response described on
 * {@link zitadelMiddleware}. Export it from `proxy.ts` as `proxy`, or as `middleware` on
 * Next.js 15.
 */
export type ProxyHandler = (req: NextRequest) => Promise<NextResponse | Response>;

/**
 * Creates a configured middleware handler from the project handle that `configureZitadel()`
 * returns, so the project, backend URL and proxy path are configured once.
 *
 * Use it when the app already calls `configureZitadel()`, and use {@link zitadelMiddleware}
 * to configure the middleware inline. The handle supplies `url` and `proxyPath`, and its project id
 * holds sessions to that project unless `options.projectId` names another. The handler behaves
 * exactly as {@link zitadelMiddleware} does.
 *
 * {@link server!auth | auth} runs in the server runtime, where the middleware's handle may
 * not be configured. It reads `ZITADEL_PROJECT_ID` or `NEXT_PUBLIC_ZITADEL_PROJECT_ID`, else a
 * handle configured there. When the project lives only in this handle, pass it as `auth({
 * projectId })` too, or sessions read as signed out on the server.
 *
 * @param config - The project handle from `configureZitadel()`.
 * @param options - Route protection and JWT options; see {@link ProxyOptions}.
 * @returns A middleware handler to export from `proxy.ts`.
 *
 * @example
 * ```ts
 * // src/zitadel.ts
 * import { configureZitadel } from "@zitadel/sdk-next/client";
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
 * @example
 * ```ts
 * // proxy.ts
 * export { proxy } from "./src/zitadel";
 * ```
 */
export function createProxy(config: ZitadelProject, options: ProxyOptions = {}): ProxyHandler {
  const mergedOptions: ZitadelMiddlewareOptions = {
    ...options,
    projectId: options.projectId ?? (config.projectId || undefined),
    proxyPath: config.proxyPath,
    url: config.url,
  };
  return (req: NextRequest) => zitadelMiddleware(req, mergedOptions);
}
