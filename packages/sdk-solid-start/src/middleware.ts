import type {
  ZitadelAuthResult,
  ZitadelMiddlewareOptions,
  ZitadelProxyRoute,
  ZitadelResolveSessionOptions,
} from "@zitadel/sdk-core/middleware";
import { joinURL } from "ufo";

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
  serializeSessionCookie,
} from "@zitadel/sdk-core/middleware";

/**
 * The process environment, or an empty map where there is no `process`.
 *
 * Some edge and serverless runtimes do not define `process`. Reading the environment through
 * this map lets an omitted `url`, `projectId` or `projectSecret` fall back to its default
 * instead of throwing a `ReferenceError` when the middleware is created.
 */
const PROCESS_ENV: Record<string, string | undefined> =
  typeof process !== "undefined" && process.env ? process.env : {};

/**
 * The slice of SolidStart's request event that the middleware reads and writes.
 *
 * SolidStart and its Vinxi and Nitro substrate are not dependencies of this package. Typing only
 * the few fields the middleware touches keeps the install light and independent of the
 * framework's bundler changes. The shape is structurally compatible with the real `FetchEvent`,
 * so the handler that {@link createZitadelMiddleware} returns can be passed straight to
 * SolidStart's `createMiddleware`.
 *
 * @example
 * ```ts
 * import type { ZitadelSolidFetchEvent } from "@zitadel/sdk-solid-start/server";
 *
 * async function logRequests(event: ZitadelSolidFetchEvent): Promise<Response | undefined> {
 *   console.log(event.request.method, new URL(event.request.url).pathname);
 *   return undefined;
 * }
 * ```
 */
export interface ZitadelSolidFetchEvent {
  /**
   * The incoming request.
   *
   * The middleware reads its URL, method, body and the `cookie`, `authorization` and
   * `x-forwarded-*` headers to proxy the same-origin proxy path and to judge the session. It
   * rejects with a `400` any request that carries the internal `x-zitadel-auth-token` header,
   * because only the middleware itself may set that header.
   */
  readonly request: Request;
  /**
   * The per-request store that SolidStart shares between the middleware and the server functions
   * and routes that run after it.
   *
   * The middleware writes the session verdict to the `zitadelAuth` key on every request it does
   * not ignore. Read the verdict back with {@link getAuth} instead of reaching into the store.
   */
  readonly locals: Record<string, unknown> & {
    /**
     * The verdict on this request's session, set by the middleware.
     *
     * It is absent on a request the middleware skipped because the path matched an ignored route,
     * or proxied, and {@link getAuth} reads an absent verdict as signed out.
     */
    zitadelAuth?: ZitadelAuthResult;
  };
  /**
   * The direct client address, when the platform adapter resolves one.
   *
   * The middleware appends it to the `x-forwarded-for` chain of a proxied request so the Zitadel
   * server sees the real client. When it is absent, the chain is forwarded as received.
   */
  readonly clientAddress?: string;
  /**
   * The response stub that SolidStart merges into the response it eventually sends.
   *
   * A middleware that lets the request continue sets headers on it. Here the headers are the
   * session cookies and a `Cache-Control` that keeps them out of shared caches. When it is
   * absent, a continuing request carries no cookie changes.
   */
  readonly response?: {
    /**
     * The headers that SolidStart sends with a normal answer.
     *
     * The middleware appends the session `Set-Cookie` headers and a `Cache-Control` here when
     * the session check asks for a cookie change and the request continues.
     */
    readonly headers: Headers;
    /**
     * The headers that h3 version 2 sends instead of the normal `headers`
     * when the answer is an error or a thrown one.
     *
     * On SolidStart 2 an answer with status 400 or above drops the normal headers. The middleware
     * writes the same cookies here so a failing page still carries them. It is absent on
     * SolidStart 1.
     */
    readonly errHeaders?: Headers;
  };
}

/**
 * The `{ onRequest }` config that {@link createZitadelMiddleware} returns.
 *
 * On SolidStart 2, pass it to `createMiddleware` from `@solidjs/start/middleware` and export the
 * result as the default of the file that `solidStart({ middleware })` names. A bare config object
 * registers nothing, so the proxy path would answer `404`.
 *
 * @example
 * ```ts
 * import { createMiddleware } from "@solidjs/start/middleware";
 * import { createZitadelMiddleware } from "@zitadel/sdk-solid-start/server";
 *
 * const zitadel = createZitadelMiddleware({ protectedRoutes: ["/admin*"] });
 *
 * export default createMiddleware({ onRequest: [...zitadel.onRequest] });
 * ```
 */
export interface ZitadelSolidMiddlewareConfig {
  /**
   * The handlers that SolidStart runs for each request, in order.
   *
   * Each handler returns a `Response` to answer the request itself, such as the proxy answer, a
   * redirect to the login page or a `503`, or `undefined` to let the request continue.
   * {@link createZitadelMiddleware} returns one handler. Spread this array into your own
   * `onRequest` to run your handlers alongside it, and put it first if later handlers need the
   * session verdict. It is a mutable array because `createMiddleware` does not accept a readonly
   * one.
   */
  readonly onRequest: Array<(event: ZitadelSolidFetchEvent) => Promise<Response | undefined>>;
}

/**
 * Parses a `Cookie` request header into a map from cookie name to value.
 *
 * @param header - The raw `Cookie` header, or `null` when the request has none.
 * @returns The cookies by name; empty when the header is absent. Parts without an `=` and
 *   parts with an empty name are skipped, and values are returned as sent, without decoding.
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
 * Builds the headers for the request that the middleware forwards to the Zitadel server.
 *
 * It copies the incoming headers and drops the hop-by-hop headers and the SDK-internal ones, so
 * a client cannot smuggle an internal channel upstream. It then sets the `x-forwarded-*` headers
 * so the server sees the real client origin. The client address comes from
 * {@link ZitadelSolidFetchEvent.clientAddress}, appended to any existing `x-forwarded-for` chain.
 *
 * @param event - The current request event.
 * @param url - The parsed URL of the incoming request, the source of the host and protocol that
 *   fill `x-forwarded-host` and `x-forwarded-proto` when the request lacks them.
 * @returns The upstream request headers.
 */
function buildUpstreamHeaders(event: ZitadelSolidFetchEvent, url: URL): Headers {
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
 * Forwards a request that the proxy handles to the Zitadel server and returns its response,
 * including its `Set-Cookie` headers.
 *
 * Hop-by-hop headers are stripped in both directions. A `location` header is kept only when it
 * redirects back onto this app, so the proxy cannot be used to send a browser elsewhere. The
 * session cookie travels under this project's name in the browser and under the server's own
 * name upstream, as {@link proxySessionCookies} translates it. Redirects are never followed
 * here; they are returned to the browser.
 *
 * @param event - The current request event.
 * @param url - The parsed URL of the incoming request.
 * @param authUrl - The base URL of the Zitadel server.
 * @param route - Where the request goes ({@link proxyRoute}).
 * @param projectId - The project id, or `undefined` when none is configured.
 * @param projectSecret - The project secret, or `undefined` when none is configured.
 * @param proxyTimeoutMs - The time in milliseconds after which the upstream call is aborted.
 * @returns The response to send to the browser.
 * @throws Error when the upstream call fails or times out.
 */
async function proxyRequest(
  event: ZitadelSolidFetchEvent,
  url: URL,
  authUrl: string,
  route: ZitadelProxyRoute,
  projectId: string | undefined,
  projectSecret: string | undefined,
  proxyTimeoutMs: number,
): Promise<Response> {
  const suffix = route.path;
  const target = `${joinURL(authUrl, suffix)}${url.search}`;

  const method = event.request.method;
  const hasBody = !["GET", "HEAD"].includes(method);
  const buffered = hasBody ? await event.request.arrayBuffer() : undefined;
  const body = buffered && buffered.byteLength > 0 ? buffered : undefined;

  const upstreamHeaders = buildUpstreamHeaders(event, url);
  for (const [name, value] of Object.entries(route.headers)) {
    upstreamHeaders.set(name, value);
  }
  const sessionCookies = proxySessionCookies(
    {
      method,
      path: suffix,
      search: url.search,
      cookie: event.request.headers.get("cookie"),
      requestUrl: url,
      forwardedProto: event.request.headers.get("x-forwarded-proto"),
      forwardedHost: event.request.headers.get("x-forwarded-host"),
    },
    projectId,
    { url: authUrl, timeoutMs: proxyTimeoutMs },
  );
  if (sessionCookies.upstreamCookie === null) {
    upstreamHeaders.delete("cookie");
  } else {
    upstreamHeaders.set("cookie", sessionCookies.upstreamCookie);
  }

  // Attach the project secret only to the session handoff exchange. On every operation it would
  // make this public boundary an open relay with project authority. A credential the caller
  // supplied is preserved.
  if (
    requiresProjectSecret(method, suffix, upstreamHeaders) &&
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
 * The options that {@link handleAuth} needs: the route policy, plus what {@link resolveSession}
 * judges the session by.
 */
interface AuthHandlerOptions extends ZitadelResolveSessionOptions {
  /**
   * The route patterns that require a signed-in session.
   */
  readonly protectedRoutes: readonly string[];
  /**
   * The relative path that signed-out visitors are redirected to.
   */
  readonly loginPath: string;
}

/**
 * Judges the session, writes the verdict to the event's `locals`, and redirects signed-out
 * visitors away from protected routes.
 *
 * Either way the response carries the session cookies that the judgement asks for. When the
 * Zitadel server cannot say whether the session is live, a protected route answers `503`
 * instead of redirecting, because the user may well be signed in.
 *
 * @param event - The current request event.
 * @param url2 - The parsed URL of the incoming request.
 * @param opts - The route policy and the session verification options.
 * @returns A redirect or `503` response, or `undefined` to let the request continue.
 */
async function handleAuth(
  event: ZitadelSolidFetchEvent,
  url2: URL,
  opts: AuthHandlerOptions,
): Promise<Response | undefined> {
  const { protectedRoutes, loginPath, ...verification } = opts;
  const { pathname } = url2;

  const cookies = parseCookieHeader(event.request.headers.get("cookie"));
  const authHeader = event.request.headers.get("authorization");
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
      forwardedProto: event.request.headers.get("x-forwarded-proto"),
      forwardedHost: event.request.headers.get("x-forwarded-host"),
    },
    verification,
  );

  event.locals.zitadelAuth = auth;
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
    return new Response("Service Unavailable", { status: 503 });
  }

  if (!auth.isAuthenticated && matchesRoutes(pathname, protectedRoutes)) {
    const headers = new Headers({ location: loginRedirectUrl(loginPath, url2).toString() });
    for (const cookie of setCookies) {
      headers.append("set-cookie", cookie);
    }
    if (setCookies.length > 0) {
      headers.set("cache-control", SESSION_COOKIE_CACHE_CONTROL);
    }
    return new Response(null, { status: 302, headers });
  }

  // Continue the SolidStart pipeline, which merges the response stub's headers
  // into the response it sends: `headers`, or with an error answer h3 v2's
  // `errHeaders`, so both carry the cookies.
  for (const target of [event.response?.headers, event.response?.errHeaders]) {
    if (target && setCookies.length > 0) {
      for (const cookie of setCookies) {
        target.append("set-cookie", cookie);
      }
      target.set("cache-control", SESSION_COOKIE_CACHE_CONTROL);
    }
  }
  return undefined;
}

/**
 * Creates a SolidStart middleware config that proxies the auth calls, verifies the session and
 * protects routes in a single `onRequest` pass.
 *
 * Use it once per app. Reference the module that exports it from the `middleware` option of the
 * `solidStart()` plugin in `vite.config.ts`, or from `app.config.ts` on older setups, and wrap
 * the config in SolidStart's own `createMiddleware` there. SolidStart 2 registers the default
 * export of that module as an array of h3 middleware, and `createMiddleware` turns the
 * `{ onRequest }` config into that array. Exporting the bare config registers nothing, so the
 * proxy path answers `404`.
 *
 * For each request the handler does three things in order. It rejects with `400` any request
 * that carries the internal `x-zitadel-auth-token` header. It forwards everything under the proxy
 * path to the Zitadel server, so the browser only ever talks to the app's own origin. It judges
 * the session of every other request and stores the verdict where {@link getAuth} reads it.
 * Requests that match `ignoredRoutes` skip all of this, and carry no verdict.
 *
 * The project secret is sent as the bearer on the session handoff exchange only. It is never sent
 * on other proxied calls, which would turn the public proxy into an open relay with project
 * authority, and it never reaches the browser. A session counts only in the app's own project:
 * `projectId`, else the `ZITADEL_PROJECT_ID` variable, else `VITE_ZITADEL_PROJECT_ID`. When the
 * server cannot say whether a session is live, a protected route answers `503` rather than
 * redirecting a signed-in user to the login page. The handler uses only Web APIs and reads
 * `process.env` defensively, so it runs on edge runtimes.
 *
 * To compose with your own handlers, pass them in the same call, as in the second example.
 *
 * Naming: SolidStart registers middleware in src/middleware.ts through createMiddleware, and
 * this factory returns the configuration object that createMiddleware takes. It is a factory,
 * called once, so it starts with create.
 *
 * @example
 * ```ts
 * import { createMiddleware } from "@solidjs/start/middleware";
 * import { createZitadelMiddleware } from "@zitadel/sdk-solid-start/server";
 *
 * export default createMiddleware(
 *   createZitadelMiddleware({
 *     url: process.env.ZITADEL_URL,
 *     projectSecret: process.env.ZITADEL_PROJECT_SECRET,
 *     protectedRoutes: ["/admin*", "/dashboard*"],
 *     loginPath: "/login",
 *   }),
 * );
 * ```
 *
 * @example
 * ```ts
 * import { createMiddleware } from "@solidjs/start/middleware";
 * import { createZitadelMiddleware } from "@zitadel/sdk-solid-start/server";
 *
 * const zitadel = createZitadelMiddleware({ protectedRoutes: ["/admin*"] });
 *
 * export default createMiddleware({
 *   onRequest: [...zitadel.onRequest, async () => undefined],
 * });
 * ```
 *
 * A signed-out request for a protected route is redirected with an absolute URL on the origin of
 * the request, such as `https://app.example.com/login?next=%2Fadmin`.
 *
 * The proxy forwards a client's `x-forwarded-host` and `x-forwarded-proto` unchanged and sets them
 * from the request only when the client sent none. It cannot tell a trusted CDN or load balancer
 * from a client, and the server builds the OAuth issuer and the `Secure` decision for session
 * cookies from those headers, so strip them at the edge when clients can reach the app directly.
 *
 * @param options - The middleware configuration, see {@link ZitadelMiddlewareOptions}. The `url`
 *   defaults to `ZITADEL_URL`, else `http://localhost:8080`, and the `projectSecret` to
 *   `ZITADEL_PROJECT_SECRET`. An empty value counts as unset.
 * @returns The SolidStart middleware config.
 * @throws Error when `loginPath` is not a relative path starting with a single `/` with no backslash. An absolute
 *   or protocol-relative URL would turn the login redirect into an open redirect, so it is
 *   refused when the middleware is created.
 */
export function createZitadelMiddleware(
  options: ZitadelMiddlewareOptions = {},
): ZitadelSolidMiddlewareConfig {
  const {
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
  } = options;
  const url = options.url || PROCESS_ENV.ZITADEL_URL || "http://localhost:8080";
  const projectSecret = options.projectSecret || PROCESS_ENV.ZITADEL_PROJECT_SECRET;

  // Guard against open-redirect: loginPath must be a relative path.
  if (!loginPath.startsWith("/") || loginPath.startsWith("//") || loginPath.includes("\\")) {
    throw new Error(
      `[zitadel] loginPath must be a relative path starting with a single "/". ` +
        `Received: "${loginPath}". Using an absolute or protocol-relative URL ` +
        `would allow open-redirect attacks.`,
    );
  }

  const onRequest = async (event: ZitadelSolidFetchEvent): Promise<Response | undefined> => {
    const url2 = new URL(event.request.url);
    const { pathname } = url2;

    // Clients never send x-zitadel-auth-token: it is an internal channel. Refuse any
    // request that carries it, on every route, before anything else runs.
    if (event.request.headers.has("x-zitadel-auth-token")) {
      return new Response("Bad Request", { status: 400 });
    }

    if (matchesRoutes(pathname, ignoredRoutes)) {
      return;
    }

    const route = proxyRoute(pathname, { proxyPath, projectId, loginPath });
    // An OAuth issuer that is not this app's project: the app answers, so its
    // origin never serves another project's issuer.
    if (route?.refused) {
      return refusedProxyResponse();
    }
    if (route) {
      return proxyRequest(event, url2, url, route, projectId, projectSecret, proxyTimeoutMs);
    }

    return handleAuth(event, url2, {
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
    });
  };

  return { onRequest: [onRequest] };
}

/**
 * Reads the session verdict from a SolidStart request event after the middleware has run.
 *
 * Call it in a server function or route to guard data and pages. Inside one, obtain the event
 * with `getRequestEvent()` from `solid-js/web`. It is safe on a request the middleware did not
 * judge, such as an ignored route: an absent verdict reads as signed out, so a guard fails
 * closed.
 *
 * Naming: Takes the framework's own request event or context and returns the verified result
 * that the handler stored on it. It reads and never creates, so it is called getAuth, and it is
 * synchronous because the framework has already handed over the event.
 *
 * @example
 * ```ts
 * import { getRequestEvent } from "solid-js/web";
 * import { getAuth } from "@zitadel/sdk-solid-start/server";
 *
 * export async function loadProfile() {
 *   "use server";
 *   const auth = getAuth(getRequestEvent()!);
 *   if (!auth.isAuthenticated) {
 *     throw new Error("Not signed in");
 *   }
 *   return auth.session;
 * }
 * ```
 *
 * @param event - The current SolidStart request event.
 * @returns The {@link ZitadelAuthResult} for the request: the session when signed in, or a signed-out
 *   result when the middleware found no valid session or did not run.
 */
export function getAuth(event: ZitadelSolidFetchEvent): ZitadelAuthResult {
  return event.locals.zitadelAuth ?? { isAuthenticated: false, session: null };
}
