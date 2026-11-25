import type { AuthResult, ZitadelMiddlewareOptions } from "@zitadel/sdk-core/middleware";
import { joinURL } from "ufo";

import {
  HOP_BY_HOP,
  INTERNAL_HEADERS,
  filterResponseHeaders,
  loginRedirectUrl,
  matchesRoutes,
  proxySessionCookies,
  SESSION_COOKIE_CACHE_CONTROL,
  requiresProjectSecret,
  resolveSession,
  serializeSessionCookie,
} from "@zitadel/sdk-core/middleware";

/**
 * The environment, read defensively.
 *
 * `process` is undefined in some edge and serverless runtimes. Reading it only when it exists
 * lets an omitted `url` or `projectSecret` fall back to its default instead of throwing a
 * `ReferenceError`.
 */
const PROCESS_ENV: Record<string, string | undefined> =
  typeof process !== "undefined" && process.env ? process.env : {};

/**
 * The decision {@link handleZitadelRequest} makes for one request.
 *
 * It is either a ready-to-send `Response` (a proxied answer, a login redirect, or a refusal) or
 * an instruction to continue the request with the resolved {@link AuthResult}, which the caller
 * attaches to the router context. Branch on `type`.
 */
export type ZitadelRequestDecision =
  | {
      /**
       * The discriminant for a request that was a call under the proxy path, forwarded to the
       * auth backend.
       */
      readonly type: "proxy";
      /**
       * The backend's answer, with the session cookie renamed for the browser.
       *
       * Send it as is.
       */
      readonly response: Response;
    }
  | {
      /**
       * The discriminant for an unauthenticated request for a protected route.
       */
      readonly type: "redirect";
      /**
       * A `302` to the login path that carries the requested path in `?next=`.
       *
       * Send it as is. It also carries the cookie updates and `Cache-Control: private,
       * no-store` when there are any. Only the pathname goes into `next`, so the query string of
       * a deep link is not restored after sign-in, and the widget follows `next` only when it
       * is a path on the page's own origin. A `302` turns a non-GET request into a GET, which is
       * why an undecided session answers `503` instead.
       */
      readonly response: Response;
    }
  | {
      /**
       * The discriminant for a refused request.
       */
      readonly type: "reject";
      /**
       * The refusal: `400` for a request that carries the internal auth header, or `503` when
       * the backend could not check the session of a protected route.
       *
       * Send it as is. The `503` is deliberate. The backend answers `500`, never `401`, when it
       * cannot decide, because the SDKs clear the session cookie on a `401`. A redirect would
       * tell a visitor who may well be signed in that they are signed out, add load to a
       * struggling backend, and drop a non-GET request. A `503` is the status that clients and
       * fetch wrappers retry, and the cookie is kept so the next request checks again.
       */
      readonly response: Response;
    }
  | {
      /**
       * The discriminant for a request that may proceed to the app.
       */
      readonly type: "continue";
      /**
       * Who the request is signed in as, or the signed-out result.
       *
       * Attach it to the router context.
       */
      readonly auth: AuthResult;
      /**
       * The `Set-Cookie` values the response to this request must carry.
       *
       * A dead session cookie is cleared so the browser stops replaying it, or a session of
       * this project is copied out of the shared cookie into the project's own. The array is
       * empty or absent when there is nothing to set. A response that carries these cookies
       * also sends `Cache-Control: private, no-store`, so no shared cache keeps them.
       */
      readonly setCookies?: readonly string[];
    };

/**
 * The options accepted by {@link handleZitadelRequest} and {@link createZitadelRequestMiddleware}.
 *
 * It is the shared {@link ZitadelMiddlewareOptions} plus two members that only this adapter
 * needs.
 */
export type ZitadelRequestOptions = ZitadelMiddlewareOptions & {
  /**
   * The project secret, sent as the bearer on the session handoff only.
   *
   * Attaching it to every operation would make the public proxy an open relay with project
   * authority, so it goes only to the handoff.
   *
   * It is attached to the `POST /sessions/exchange` call and to no other proxied operation,
   * and it is never sent to the browser. A credential the caller supplied is kept instead.
   * Read it from a server-only environment variable.
   *
   * @defaultValue The `ZITADEL_PROJECT_SECRET` environment variable, or none when it is unset.
   */
  readonly projectSecret?: string;
  /**
   * The direct client address, appended to the `X-Forwarded-For` chain.
   *
   * Supply the address your server runtime provides. A request header is never used, because a
   * client could forge it. An edge runtime hands the address over instead of the middleware
   * reading a header, so pass it here on edge runtimes. A client-supplied `x-real-ip`, or any
   * other request header, is never taken as the client address, because anyone can set it when
   * the app is reachable directly. The address is appended to an existing `X-Forwarded-For`
   * chain, and when none is supplied the chain is forwarded as it is.
   *
   * @defaultValue None, so the chain is forwarded unchanged.
   */
  readonly clientAddress?: string;
};

/**
 * Builds the headers sent upstream: the request's own, minus hop-by-hop and internal ones.
 *
 * The client address is appended to `X-Forwarded-For`, and `X-Forwarded-Host` and
 * `X-Forwarded-Proto` are set from the request URL when the request has none.
 *
 * @param request - The incoming Web `Request`.
 * @param url - The parsed URL of `request`.
 * @param clientAddress - The direct client address, or `undefined` when the runtime gives none.
 * @returns The headers for the upstream request.
 */
function buildUpstreamHeaders(
  request: Request,
  url: URL,
  clientAddress: string | undefined,
): Headers {
  const headers = new Headers();
  for (const [key, value] of request.headers) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || INTERNAL_HEADERS.has(lower)) {
      continue;
    }
    headers.set(key, value);
  }

  const clientIp = clientAddress;
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
 * Forwards a `/__nextgen/*` request to the upstream auth backend.
 *
 * The session cookie travels under this project's name in the browser and under the server's
 * name upstream, see {@link proxySessionCookies}. Each project keeps its session in its own
 * cookie, because a browser shares one cookie jar across every port of a host, and apps and the
 * Console on `localhost` would otherwise sign each other out. Another project's session cookie
 * is never forwarded. The backend url and path are joined so a trailing slash on the url is
 * ignored. Cookies set on the response add `Cache-Control: private, no-store`. The project secret is attached as a bearer
 * only to the session handoff, and a credential the caller supplied is preserved. Redirects
 * are not followed, and the upstream call is aborted after `proxyTimeoutMs`.
 *
 * @param request - The incoming Web `Request`.
 * @param url - The parsed URL of `request`.
 * @param authUrl - The base URL of the auth backend.
 * @param proxyPath - The same-origin proxy path prefix to strip.
 * @param projectId - The project id, used to name the project's session cookie.
 * @param projectSecret - The project secret, sent only on the session handoff.
 * @param clientAddress - The direct client address to append to `X-Forwarded-For`.
 * @param proxyTimeoutMs - The upstream timeout in milliseconds.
 * @returns The backend's answer, with the session cookie renamed for the browser.
 */
async function proxyRequest(
  request: Request,
  url: URL,
  authUrl: string,
  proxyPath: string,
  projectId: string | undefined,
  projectSecret: string | undefined,
  clientAddress: string | undefined,
  proxyTimeoutMs: number,
): Promise<Response> {
  const suffix = url.pathname.slice(proxyPath.length);
  const target = `${joinURL(authUrl, suffix)}${url.search}`;

  const method = request.method;
  const hasBody = !["GET", "HEAD"].includes(method);
  const body = hasBody ? await request.arrayBuffer() : undefined;

  const upstreamHeaders = buildUpstreamHeaders(request, url, clientAddress);
  const sessionCookies = proxySessionCookies(
    {
      method,
      path: suffix,
      search: url.search,
      cookie: request.headers.get("cookie"),
      requestUrl: url,
      forwardedProto: request.headers.get("x-forwarded-proto"),
      forwardedHost: request.headers.get("x-forwarded-host"),
    },
    projectId,
    { url: authUrl, timeoutMs: proxyTimeoutMs },
  );
  if (sessionCookies.upstreamCookie === null) {
    upstreamHeaders.delete("cookie");
  } else {
    upstreamHeaders.set("cookie", sessionCookies.upstreamCookie);
  }

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
 * Parses a `Cookie` request header into a map of cookie names to values.
 *
 * @param header - The raw `Cookie` header, or `null` when the request has none.
 * @returns A map from cookie name to value, empty when the header is absent.
 */
function parseCookieHeader(header: string | null): Map<string, string> {
  const jar = new Map<string, string>();
  if (!header) {
    return jar;
  }
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) {
      jar.set(name, value);
    }
  }
  return jar;
}

/**
 * Decides what to do with a single request: proxy it, redirect it, refuse it, or let it
 * through with the resolved session.
 *
 * This is the framework-agnostic core that {@link createZitadelRequestMiddleware} wraps. It takes a
 * Web `Request` and returns a {@link ZitadelRequestDecision}, so the full auth contract is
 * testable without TanStack Start, and a custom server entry can use it directly. The checks
 * run in this order:
 *
 * 1. A request that carries the internal `x-zitadel-auth-token` header is refused with `400` on
 *    every route, including ignored routes and the proxy path, and before anything else runs.
 *    The header is an internal channel that only an SDK writes after verifying a session.
 *    Refusing it outright is safer than removing it, because no framework's header
 *    mutability matters and no code path can forget a route.
 * 2. A path in {@link ZitadelMiddlewareOptions.ignoredRoutes} continues signed out, without any
 *    session check.
 * 3. A path under {@link ZitadelMiddlewareOptions.proxyPath} is forwarded to the auth backend.
 *    The project secret is attached only to the session handoff and never sent to the browser,
 *    because on every operation it would turn this public boundary into an open relay with
 *    project authority. The client address comes only from
 *    {@link ZitadelRequestOptions | clientAddress}, never from a request header, so a client
 *    cannot forge it.
 * 4. Any other path has its session resolved from the `Authorization` bearer token or the
 *    session cookie. A session counts only in the app's own project: the project id comes from
 *    {@link ZitadelMiddlewareOptions.projectId}, else the `ZITADEL_PROJECT_ID` environment
 *    variable, else `VITE_ZITADEL_PROJECT_ID`. A signed-out request for a protected route
 *    redirects to the login path with the requested path in `?next=`, and a protected route
 *    whose session the backend could not check answers `503` instead, because the visitor may
 *    well be signed in. The session cookie is cleared only when the backend refuses the session
 *    (a `401`, or a `404` that says the session is gone). A timeout, a `5xx` or a network error
 *    gives no verdict, so the cookie stays and a public route renders signed out. A live
 *    session that signs no one in, such as an anonymous one or one of another project, keeps
 *    its cookie, and an anonymous session does not pass a protected route. A bearer token is
 *    judged before the cookie. With no project id configured, nobody is signed in.
 *
 * Options left unset fall back to the shared defaults, and `url` and `projectSecret` also read
 * `ZITADEL_URL` and `ZITADEL_PROJECT_SECRET` when `process` exists. On an edge runtime without
 * `process` they fall back to the defaults instead of throwing.
 *
 * @param request - The incoming Web `Request`.
 * @param options - The configuration, defaulting to an empty object.
 * @returns A {@link ZitadelRequestDecision} that tells the caller what to send or do next.
 * @throws Error when {@link ZitadelMiddlewareOptions.loginPath} is not a relative path starting
 *   with a single `/`, which would allow open-redirect attacks.
 *
 * @example
 * ```ts
 * import { handleZitadelRequest } from "@zitadel/sdk-tanstack-start/server";
 *
 * export async function handle(request: Request): Promise<Response> {
 *   const decision = await handleZitadelRequest(request, { protectedRoutes: ["/admin*"] });
 *   if (decision.type !== "continue") {
 *     return decision.response;
 *   }
 *   return render(request, decision.auth);
 * }
 * ```
 */
export async function handleZitadelRequest(
  request: Request,
  options: ZitadelRequestOptions = {},
): Promise<ZitadelRequestDecision> {
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
    clientAddress,
  } = options;

  // Guard against open-redirect: loginPath must be a relative path.
  if (!loginPath.startsWith("/") || loginPath.startsWith("//")) {
    throw new Error(
      `[zitadel] loginPath must be a relative path starting with a single "/". ` +
        `Received: "${loginPath}". Using an absolute or protocol-relative URL ` +
        `would allow open-redirect attacks.`,
    );
  }

  const url2 = new URL(request.url);
  const { pathname } = url2;

  // Clients never send x-zitadel-auth-token: it is an internal channel. Refuse any
  // request that carries it, on every route, before anything else runs.
  if (request.headers.has("x-zitadel-auth-token")) {
    return { type: "reject", response: new Response("Bad Request", { status: 400 }) };
  }

  if (matchesRoutes(pathname, ignoredRoutes)) {
    return { type: "continue", auth: { isAuthenticated: false, session: null } };
  }

  if (pathname === proxyPath || pathname.startsWith(`${proxyPath}/`)) {
    const response = await proxyRequest(
      request,
      url2,
      url,
      proxyPath,
      projectId,
      projectSecret,
      clientAddress,
      proxyTimeoutMs,
    );
    return { type: "proxy", response };
  }

  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const {
    auth,
    undecided,
    cookies: sessionCookies,
  } = await resolveSession(
    {
      bearer: bearerToken,
      cookie: (name) => cookies.get(name),
      requestUrl: url2,
      forwardedProto: request.headers.get("x-forwarded-proto"),
      forwardedHost: request.headers.get("x-forwarded-host"),
    },
    {
      url,
      projectId,
      allowedAlgorithms,
      clockSkewMs,
      audience,
      allowedTokenTypes,
      jwksTimeoutMs,
      opaqueTokenTimeoutMs,
    },
  );

  // A dead session's cookie is cleared so the browser stops replaying it (each
  // replay costs a backend session check), and a session of this project still
  // under the shared name is copied to the project's own cookie. A live session
  // that signs no one in here (an anonymous one, whose sign-in may still
  // complete, or one of another project) keeps its cookie, and so does one the
  // backend gave no verdict on.
  const setCookies = sessionCookies.map(serializeSessionCookie);

  // The backend could not say whether the session is live. The user may well
  // be signed in, so a protected route answers 503 rather than send them to
  // the login page.
  if (undecided && matchesRoutes(pathname, protectedRoutes)) {
    return { type: "reject", response: new Response("Service Unavailable", { status: 503 }) };
  }

  if (!auth.isAuthenticated && matchesRoutes(pathname, protectedRoutes)) {
    const headers = new Headers({ location: loginRedirectUrl(loginPath, url2).toString() });
    for (const cookie of setCookies) {
      headers.append("set-cookie", cookie);
    }
    if (setCookies.length > 0) {
      headers.set("cache-control", SESSION_COOKIE_CACHE_CONTROL);
    }
    return { type: "redirect", response: new Response(null, { status: 302, headers }) };
  }

  return {
    type: "continue",
    auth,
    ...(setCookies.length > 0 ? { setCookies } : {}),
  };
}

/**
 * The slice of TanStack Start's request-middleware context that this package uses.
 *
 * TanStack Start is not a dependency of this package. Typing only the two fields the handler
 * touches keeps the install light and resilient to changes in TanStack's server middleware
 * API, and the shape stays structurally compatible with the real context.
 */
export interface RequestMiddlewareContext {
  /**
   * The incoming Web `Request`, as TanStack Start's request middleware receives it.
   */
  readonly request: Request;
  /**
   * Hands the request on to the rest of the app.
   *
   * Pass `context` to add values that server functions read from their own context. The
   * handler adds `zitadelAuth`. TanStack Start returns the result with or without a promise,
   * so the type accepts both, and the handler awaits the result either way. The type is
   * hand-written, and not imported, so it stays free of TanStack's changing middleware generics.
   */
  readonly next: (opts?: {
    /**
     * The values merged into the context that downstream handlers receive.
     */
    readonly context?: Record<string, unknown>;
  }) =>
    | Promise<{
        /**
         * The app's response, which the middleware may add cookies to.
         */
        readonly response: Response;
      }>
    | {
        /**
         * The app's response, which the middleware may add cookies to.
         */
        readonly response: Response;
      };
}

/**
 * The key under which the auth result is placed on the router context.
 */
const CONTEXT_KEY = "zitadelAuth";

/**
 * Creates a TanStack Start request-middleware server handler that proxies auth traffic,
 * verifies the session, and protects routes.
 *
 * Register the handler as a global request middleware in the framework server entry,
 * `src/start.ts`. It wraps {@link handleZitadelRequest}: a proxy, redirect or refusal decision
 * is returned as the response, and a `continue` decision calls `next` with the result under the
 * `zitadelAuth` context key, so loaders and server functions read it with {@link getAuth}. When
 * the decision carries cookies to set, the handler copies the downstream response (its headers
 * may be immutable), appends them, and marks it `Cache-Control: private, no-store` so no shared
 * cache keeps them. The login redirect and the cookie rules are those of
 * {@link handleZitadelRequest}. TanStack Start is not a dependency of this package, so the handler is typed
 * against {@link RequestMiddlewareContext} instead.
 *
 * Naming: TanStack Start has request middleware and function middleware, both registered in
 * start.ts, so the name says RequestMiddleware to tell the two apart. It is a factory, called
 * once to return the middleware, so it starts with create.
 *
 * @param options - The middleware configuration, see {@link ZitadelRequestOptions}.
 * @returns A request-middleware server handler that resolves to the response to send.
 * @throws Error when {@link ZitadelMiddlewareOptions.loginPath} is not a relative path. The
 *   error surfaces on the first request that reaches the handler.
 *
 * @example
 * ```ts
 * import { createMiddleware, createStart } from "@tanstack/react-start";
 * import { createZitadelRequestMiddleware } from "@zitadel/sdk-tanstack-start/server";
 *
 * const authMiddleware = createMiddleware({ type: "request" }).server(
 *   createZitadelRequestMiddleware({
 *     url: process.env.ZITADEL_URL,
 *     projectSecret: process.env.ZITADEL_PROJECT_SECRET,
 *     protectedRoutes: ["/admin*"],
 *     loginPath: "/login",
 *   }),
 * );
 *
 * export const startInstance = createStart(() => ({
 *   requestMiddleware: [authMiddleware],
 * }));
 * ```
 */
export function createZitadelRequestMiddleware(
  options: ZitadelRequestOptions = {},
): (ctx: RequestMiddlewareContext) => Promise<Response> {
  return async ({ request, next }: RequestMiddlewareContext): Promise<Response> => {
    const decision = await handleZitadelRequest(request, options);

    if (decision.type === "continue") {
      const result = await next({ context: { [CONTEXT_KEY]: decision.auth } });
      if (!decision.setCookies?.length) {
        return result.response;
      }
      // A downstream response's headers may be immutable; copy before adding.
      const response = new Response(result.response.body, result.response);
      for (const cookie of decision.setCookies) {
        response.headers.append("set-cookie", cookie);
      }
      response.headers.set("cache-control", SESSION_COOKIE_CACHE_CONTROL);
      return response;
    }
    return decision.response;
  };
}

/**
 * Reads the auth state that {@link createZitadelRequestMiddleware} placed on the request context.
 *
 * A server function receives the request-middleware context, and this function picks the
 * `zitadelAuth` value out of it. Use it in a server function to learn who is signed in, and
 * call that server function from a route's `beforeLoad` to guard the route. Do not read the
 * route's own `beforeLoad` context directly: TanStack Start nests request-middleware context
 * under `serverContext`, and on a client-side navigation `beforeLoad` runs in the browser, where
 * the value does not exist.
 *
 * When the context is `undefined` or carries no `zitadelAuth` (the middleware is not registered,
 * or the route is in {@link ZitadelMiddlewareOptions.ignoredRoutes}), the result is the
 * signed-out value, so a caller never has to check for a missing result.
 *
 * Naming: Takes the framework's own request event or context and returns the verified result
 * that the handler stored on it. It reads and never creates, so it is called getAuth, and it is
 * synchronous because the framework has already handed over the event.
 *
 * @param context - The context a server function handler receives, or `undefined`.
 * @returns The current {@link AuthResult}, signed out when the context carries none.
 *
 * @example
 * ```ts
 * import { createServerFn } from "@tanstack/react-start";
 * import { getAuth } from "@zitadel/sdk-tanstack-start/server";
 *
 * export const getUser = createServerFn().handler(({ context }) => {
 *   return getAuth(context).session;
 * });
 * ```
 */
export function getAuth(context: { readonly zitadelAuth?: AuthResult } | undefined): AuthResult {
  return context?.zitadelAuth ?? { isAuthenticated: false, session: null };
}
