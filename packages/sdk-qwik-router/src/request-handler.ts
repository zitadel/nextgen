import type {
  AuthResult,
  ZitadelMiddlewareOptions,
  ProxyRoute,
  ResolveSessionOptions,
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
} from "@zitadel/sdk-core/middleware";

/**
 * The process environment, or an empty map when there is none.
 *
 * `process` is undefined in some edge and serverless runtimes, so the environment is read
 * defensively. That way the `process.env` fallback never throws a `ReferenceError`. The Qwik
 * Router environment getter ({@link QwikRequestEvent.env}) is the primary source; this is only
 * the fallback.
 */
const PROCESS_ENV: Record<string, string | undefined> =
  typeof process !== "undefined" && process.env ? process.env : {};

/**
 * A cookie as `ev.cookie.get` of Qwik Router returns it.
 *
 * Only the value is declared because it is the only field the handler reads. The real Qwik
 * Router cookie object has more fields and is structurally assignable to this type, so you never
 * build one yourself.
 */
export interface QwikCookieValue {
  /**
   * The decoded value of the cookie, as sent by the browser or set earlier in the same request.
   */
  readonly value: string;
}

/**
 * The options of `ev.cookie.set` that the handler passes when it applies the session cookies a
 * verdict asks for.
 *
 * The handler always sets `path: "/"`, `httpOnly: true` and `sameSite: "lax"`, so the session
 * cookie is never readable from page scripts and is still sent on a top-level navigation back
 * to the app, for example the redirect from an identity provider. You never build this type; it
 * documents what {@link createZitadelOnRequest} writes. Only `secure` and `maxAge` vary, and
 * both come from the session verdict.
 */
export interface QwikCookieOptions {
  /**
   * The path the cookie applies to.
   *
   * The handler always passes `"/"`, so every route of the app sees the session.
   */
  readonly path?: string;
  /**
   * Whether the cookie is hidden from `document.cookie`.
   *
   * The handler always passes `true`: the browser never needs to read the session token, and
   * keeping it away from page scripts limits what a script injection can steal.
   */
  readonly httpOnly?: boolean;
  /**
   * The `SameSite` policy of the cookie.
   *
   * The handler always passes `"lax"`, which keeps the cookie on the top-level redirect back
   * from an identity provider and still withholds it from cross-site subrequests.
   */
  readonly sameSite?: "lax";
  /**
   * Whether the cookie is restricted to HTTPS.
   *
   * The handler takes this from the session verdict, so it follows the scheme the app is served
   * on, and a plain HTTP development server still receives its cookie.
   */
  readonly secure?: boolean;
  /**
   * The lifetime of the cookie in seconds.
   *
   * The handler omits it for a browser-session cookie that lives until the browser closes. A
   * verdict that asks for a lifetime of `0` is applied as a deletion instead of a `set`.
   */
  readonly maxAge?: number;
}

/**
 * The slice of the Qwik Router `RequestEvent` that the handler reads.
 *
 * `@qwik.dev/router` is a peer dependency, not a runtime dependency. Typing only the handful of
 * fields the handler touches keeps the built output free of a Qwik import, the same way
 * `sdk-nuxt` shims the imports of Nuxt. The shape is structurally compatible with the real
 * `RequestEvent` (a type-level test asserts it), so the handler that
 * {@link createZitadelOnRequest} returns drops straight into an `onRequest` export. You never
 * build one; Qwik passes the real event. Use this type only to type a test double for the
 * handler.
 *
 * @example
 * ```ts
 * import type { QwikRequestEvent } from "@zitadel/sdk-qwik-router/server";
 *
 * function clientAddress(ev: Pick<QwikRequestEvent, "clientConn">): string | undefined {
 *   return ev.clientConn.ip;
 * }
 * ```
 */
export interface QwikRequestEvent {
  /**
   * The incoming request.
   *
   * Its headers, cookies and body are what the handler judges or proxies.
   */
  readonly request: Request;
  /**
   * The parsed request URL.
   *
   * Its `pathname` decides whether the request is ignored, proxied or checked. Its host and
   * protocol become the `X-Forwarded-Host` and `X-Forwarded-Proto` headers of a proxied request
   * when the incoming request does not already carry them.
   */
  readonly url: URL;
  /**
   * The per-request storage shared with loaders, actions and endpoints.
   *
   * The handler stores the auth result here under a fixed key for {@link getAuth} to read. The
   * map lives for one request only, so nothing in it outlives the response.
   */
  readonly sharedMap: Map<string, unknown>;
  /**
   * The facts the platform adapter knows about the connection.
   */
  readonly clientConn: {
    /**
     * The IP address of the client.
     *
     * The handler appends it to `X-Forwarded-For` on a proxied request, after any chain already
     * present, so the auth server sees the real client. It is `undefined` when the adapter
     * cannot tell, and then the header is left as received.
     */
    readonly ip?: string;
  };
  /**
   * The cookie jar of Qwik Router.
   *
   * The handler reads the session cookie from it and writes or deletes the session cookies that
   * a verdict asks for. Qwik applies the changes to whichever response goes out, including a
   * redirect the handler throws.
   */
  readonly cookie: {
    /**
     * Reads one cookie of the request.
     *
     * @param name - The cookie name.
     * @returns The cookie, or `null` when the request carries none by that name.
     */
    get(name: string): QwikCookieValue | null;
    /**
     * Reads every cookie of the request.
     *
     * @returns The cookies keyed by name.
     */
    getAll(): Record<string, QwikCookieValue>;
    /**
     * Sets a cookie on the outgoing response.
     *
     * @param name - The cookie name.
     * @param value - The cookie value.
     * @param options - See {@link QwikCookieOptions}.
     */
    set(name: string, value: string, options?: QwikCookieOptions): void;
    /**
     * Expires a cookie on the outgoing response.
     *
     * The handler uses it for a session that the backend reports dead, so the browser stops
     * replaying it and every replay stops costing a backend session check.
     *
     * @param name - The cookie name.
     * @param options - The `path` the cookie was set on.
     */
    delete(name: string, options?: { path?: string }): void;
  };
  /**
   * The headers of the response that goes out, including those of a redirect the handler throws.
   *
   * The handler sets `cache-control: private, no-store` here whenever it writes or clears a
   * session cookie, the same value the Zitadel server sends on its own session answers, so a
   * shared cache never hands one visitor's cookie, or its clearing, to the next visitor. It is
   * optional only so that unit-test doubles need not stub it; when it is absent the header is
   * not set.
   */
  readonly headers?: Headers;
  /**
   * Sends a custom response and ends the request chain.
   *
   * The handler uses it for the proxied answer, for a `400` when the request carries the
   * internal auth header, and for a `503` when a protected route's session cannot be judged.
   *
   * @param response - The response to send.
   */
  send(response: Response): void;
  /**
   * Returns a redirect marker for the caller to throw.
   *
   * The handler throws it to send an unauthenticated visitor of a protected route to the login
   * page.
   *
   * @param statusCode - The HTTP redirect status.
   * @param url - The target, always a path on this app.
   * @returns The marker for the caller to `throw`.
   */
  redirect(statusCode: number, url: string): unknown;
  /**
   * The platform environment getter of Qwik Router.
   *
   * This is how server environment reaches the handler. Vite and Qwik load `.env` and
   * `.env.local` into this getter, not into `process.env`, so the handler reads `ZITADEL_URL`,
   * `ZITADEL_PROJECT_SECRET` and the project id here first and falls back to `process.env` only
   * for production adapters that set it. This mirrors how SvelteKit reads
   * `$env/dynamic/private`. It is optional only so that unit-test doubles that exercise only the
   * auth path need not stub it; the history records no other reason.
   */
  readonly env?: {
    /**
     * Reads one environment variable.
     *
     * @param key - The variable name.
     * @returns The value, or `undefined` when it is not set.
     */
    get(key: string): string | undefined;
  };
}

/**
 * Parses a `Cookie` request header into a map from cookie name to value.
 *
 * Entries without an `=` or with an empty name are skipped. It is the fallback for a cookie that
 * the Qwik cookie jar does not report.
 *
 * @param header - The raw `Cookie` header, or `null` when the request has none.
 * @returns The cookies keyed by name; empty when the header is absent.
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
 * Builds the headers of the upstream request.
 *
 * It copies all incoming headers, drops the hop-by-hop headers and the headers that are internal
 * to the SDK, and sets `X-Forwarded-Host` and `X-Forwarded-Proto` when they are missing, so the
 * auth server sees the real client origin. The client IP comes from
 * {@link QwikRequestEvent.clientConn} and is appended to any existing `X-Forwarded-For` chain.
 *
 * @param ev - The current request event.
 * @returns The headers to send to the auth backend.
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
 * Forwards a request that the proxy handles to the auth backend and returns its response.
 *
 * The response keeps its `Set-Cookie` headers. Hop-by-hop headers are stripped in both
 * directions, and a `location` header is kept only when it is a redirect onto this app, so the
 * backend cannot send the browser to another origin. The session cookie travels under the name
 * of this project in the browser and under the name of the server upstream. The project secret
 * is attached as a bearer only on the session handoff exchange, because attaching it to every
 * operation would turn this public boundary into an open relay with project authority; a
 * credential supplied by the caller is preserved. Redirects are not followed, so the browser
 * sees them. The target is built by joining the backend URL and the path, so a trailing slash on
 * the configured backend URL is harmless; plain concatenation used to produce a double slash and
 * an issuer mismatch on every token. Another project's session cookie is never forwarded
 * upstream: the cookie of this project is sent under the name the server expects.
 *
 * @param ev - The current request event.
 * @param authUrl - The base URL of the auth backend.
 * @param route - Where the request goes ({@link proxyRoute}).
 * @param projectId - The project id the session cookie is scoped to, or `undefined` when none is
 *   configured.
 * @param projectSecret - The project secret, or `undefined` when none is configured.
 * @param proxyTimeoutMs - The time in milliseconds after which the upstream call is aborted.
 * @returns The response to send to the browser.
 * @throws The `TimeoutError` of `AbortSignal.timeout` when the backend does not answer within
 *   `proxyTimeoutMs`, and the network error of `fetch` when it is unreachable.
 */
async function proxyResponse(
  ev: QwikRequestEvent,
  authUrl: string,
  route: ProxyRoute,
  projectId: string | undefined,
  projectSecret: string | undefined,
  proxyTimeoutMs: number,
): Promise<Response> {
  const suffix = route.path;
  const target = `${joinURL(authUrl, suffix)}${ev.url.search}`;

  const method = ev.request.method;
  const hasBody = !["GET", "HEAD"].includes(method);
  const buffered = hasBody ? await ev.request.arrayBuffer() : undefined;
  const body = buffered && buffered.byteLength > 0 ? buffered : undefined;

  const upstreamHeaders = buildUpstreamHeaders(ev);
  for (const [name, value] of Object.entries(route.headers)) {
    upstreamHeaders.set(name, value);
  }
  const sessionCookies = proxySessionCookies(
    {
      method,
      path: suffix,
      search: ev.url.search,
      cookie: ev.request.headers.get("cookie"),
      requestUrl: ev.url,
      forwardedProto: ev.request.headers.get("x-forwarded-proto"),
      forwardedHost: ev.request.headers.get("x-forwarded-host"),
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
  const responseHeaders = filterResponseHeaders(upstream.headers, ev.url.toString());
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
 * The key under which the auth result is stored on {@link QwikRequestEvent.sharedMap}.
 */
const SHARED_MAP_KEY = "zitadelAuth";

/**
 * The route policy, plus what the shared session resolution judges the session by.
 */
interface AuthHandlerOptions extends ResolveSessionOptions {
  /**
   * The route patterns that require a signed-in session.
   */
  readonly protectedRoutes: readonly string[];
  /**
   * The path of the login page that an unauthenticated visitor is sent to.
   */
  readonly loginPath: string;
}

/**
 * Judges the session and writes the auth result to {@link QwikRequestEvent.sharedMap}.
 *
 * It sets the session cookies the judgement asks for. On a protected route with nobody signed in
 * it throws the redirect to the login page, with the requested path in `?next=`. When the
 * backend cannot say whether the session is live, a protected route answers `503` instead, so a
 * visitor who may well be signed in is not sent to the login page. A `503` is the status that
 * clients and fetch wrappers retry, whereas a redirect would also drop a non-GET request such as
 * a form post.
 *
 * Cookies are cleared only when Zitadel refuses the session: a `401`, or a `404` that reports the
 * session as gone. A `5xx`, a timeout, a network error or an unreadable answer is no verdict and
 * keeps the cookie, because the server answers `500` when it cannot decide, so a database blip
 * must not sign every user out. A live anonymous session, whose sign-in may still complete, and a
 * live session of another project keep their cookie too. A session counts only in the project
 * of the app, because a browser sends one host's cookies to every app on it; with no project
 * configured nobody is signed in. A session found under the shared old cookie name is copied to
 * the cookie of this project, and the old cookie stays, because another app on the host, such as
 * the Console, may still rely on it.
 *
 * @param ev - The current request event.
 * @param opts - The route policy and the verification options.
 * @returns A promise that resolves when the request may continue, or after the `503` was sent.
 * @throws The redirect marker of `ev.redirect` for an unauthenticated visitor of a protected
 *   route.
 */
async function handleAuth(ev: QwikRequestEvent, opts: AuthHandlerOptions): Promise<void> {
  const { protectedRoutes, loginPath, ...verification } = opts;
  const { pathname } = ev.url;

  const cookies = parseCookieHeader(ev.request.headers.get("cookie"));
  const authHeader = ev.request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const {
    auth,
    undecided,
    cookies: sessionCookies,
  } = await resolveSession(
    {
      bearer: bearerToken,
      cookie: (name) => ev.cookie.get(name)?.value ?? cookies.get(name),
      requestUrl: ev.url,
      forwardedProto: ev.request.headers.get("x-forwarded-proto"),
      forwardedHost: ev.request.headers.get("x-forwarded-host"),
    },
    verification,
  );

  ev.sharedMap.set(SHARED_MAP_KEY, auth);

  // The backend could not say whether the session is live. The user may well
  // be signed in, so a protected route answers 503 rather than send them to
  // the login page.
  if (undecided && matchesRoutes(pathname, protectedRoutes)) {
    ev.send(new Response("Service Unavailable", { status: 503 }));
    return;
  }

  // A dead session's cookie is cleared so the browser stops replaying it (each
  // replay costs a backend session check), and a session of this project still
  // under the shared name is copied to the project's own cookie. A live session
  // that signs no one in here (an anonymous one, whose sign-in may still
  // complete, or one of another project) keeps its cookie, and so does one the
  // backend gave no verdict on. Qwik applies the changes to whichever response
  // goes out.
  for (const cookie of sessionCookies) {
    ev.cookie.set(cookie.name, cookie.value, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: cookie.secure,
      ...(cookie.maxAge === undefined ? {} : { maxAge: cookie.maxAge }),
    });
  }
  if (sessionCookies.length > 0) {
    ev.headers?.set("cache-control", SESSION_COOKIE_CACHE_CONTROL);
  }

  if (!auth.isAuthenticated && matchesRoutes(pathname, protectedRoutes)) {
    const loginUrl = loginRedirectUrl(loginPath, ev.url);
    throw ev.redirect(302, `${loginUrl.pathname}${loginUrl.search}`);
  }
}

/**
 * Creates the Qwik Router `onRequest` handler that proxies, verifies sessions and guards routes
 * in a single pass.
 *
 * Use it once per app, in a root plugin such as `src/routes/plugin@zitadel.ts` or in a root
 * layout, so it runs before every route. It replaces hand-written auth plumbing: without it the
 * browser cannot reach the same-origin proxy path, {@link getAuth} has nothing to read, and no
 * route is guarded. On each request it works in this order. It answers `400` when the request
 * carries the internal `x-zitadel-auth-token` header. That header is an internal channel that
 * only the SDK writes after verifying a session, so refusing it outright, on every route
 * including ignored routes and the proxy path, is safer than trying to strip it. A client that
 * copies headers from an earlier response and sends it is rejected, not ignored. It skips paths
 * matched by `ignoredRoutes`. It proxies the proxy path to the Zitadel backend. For every other
 * request it judges the session, stores the result for {@link getAuth}, applies the session
 * cookies the verdict asks for, and redirects an unauthenticated visitor of a protected route.
 *
 * The backend URL, the project secret and the project id are read on every request, never once
 * when the handler is built. The order is the explicit option, then the Qwik Router environment
 * getter ({@link QwikRequestEvent.env}, where Vite loads `.env` and `.env.local`), then
 * `process.env`. A factory-time read would miss `.env` files, because Qwik does not put them on
 * `process.env`, and the proxy would fall back to the default `http://localhost:8080` and fail
 * with "fetch failed". The project id resolves from the `projectId` option, then
 * `ZITADEL_PROJECT_ID`, then `PUBLIC_ZITADEL_PROJECT_ID`, and a session counts only when it
 * belongs to that project; the session cookie is the one named for that project, not a cookie
 * shared with other apps on the host. The backend URL may end in a slash. The project secret is attached as a bearer only on the session
 * handoff exchange and never reaches the browser.
 *
 * `protectedRoutes` guards full page loads only. A client-side `<Link>` navigation does not load
 * the page from the server, so guard those routes with a `routeLoader$` that calls
 * {@link getAuth}. When the backend cannot say whether a session is live, a protected route
 * answers `503` instead of redirecting.
 *
 * Naming: A Qwik Router route file exports its server hook as onRequest, so the name ends in
 * OnRequest and the call reads export const onRequest = createZitadelOnRequest(...). It is a
 * factory, called once to return the handler, so it starts with create.
 *
 * A signed-out request for a protected route is redirected with a relative URL, such as
 * `/login?next=%2Fadmin`, which the browser resolves against the origin it used.
 *
 * The proxy forwards a client's `x-forwarded-host` and `x-forwarded-proto` unchanged and sets them
 * from the request only when the client sent none. It cannot tell a trusted CDN or load balancer
 * from a client, and the server builds the OAuth issuer and the `Secure` decision for session
 * cookies from those headers, so strip them at the edge when clients can reach the app directly.
 *
 * @param options - See {@link ZitadelMiddlewareOptions}. The `projectSecret` takes precedence over
 *   `ZITADEL_PROJECT_SECRET`, and an empty `url` or `projectSecret` counts as unset.
 * @returns The `onRequest` handler to export from a root plugin or layout.
 * @throws An `Error` when `loginPath` is not a relative path that starts with a single `/` and has no backslash. An
 *   absolute or protocol-relative URL would allow an open redirect, so it is refused when the
 *   handler is built rather than at the first redirect.
 * @defaultValue `{}`, which uses the defaults of {@link ZitadelMiddlewareOptions} and the
 *   environment.
 * @example
 * ```ts
 * // src/routes/plugin@zitadel.ts
 * import { createZitadelOnRequest } from "@zitadel/sdk-qwik-router/server";
 *
 * export const onRequest = createZitadelOnRequest({
 *   protectedRoutes: ["/admin*", "/dashboard*"],
 *   loginPath: "/login",
 * });
 * ```
 */
export function createZitadelOnRequest(
  options: ZitadelMiddlewareOptions = {},
): (ev: QwikRequestEvent) => Promise<void> {
  const {
    url: urlOption,
    projectId: projectIdOption,
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
    projectSecret: projectSecretOption,
  } = options;

  // Guard against open-redirect: loginPath must be a relative path.
  if (!loginPath.startsWith("/") || loginPath.startsWith("//") || loginPath.includes("\\")) {
    throw new Error(
      `[zitadel] loginPath must be a relative path starting with a single "/". ` +
        `Received: "${loginPath}". Using an absolute or protocol-relative URL ` +
        `would allow open-redirect attacks.`,
    );
  }

  return async (ev: QwikRequestEvent): Promise<void> => {
    const { pathname } = ev.url;

    // Clients never send x-zitadel-auth-token: it is an internal channel. Refuse any
    // request that carries it, on every route, before anything else runs.
    if (ev.request.headers.has("x-zitadel-auth-token")) {
      ev.send(new Response("Bad Request", { status: 400 }));
      return;
    }

    // Resolve the backend URL and project secret per request. Precedence:
    // explicit option > Qwik Router's `ev.env` (which carries `.env.local`) >
    // `process.env` (set in production adapters) > localhost default. Qwik does
    // not surface `.env` files on `process.env`, so a factory-time read would
    // miss them and the proxy would fall back to :8080 ("fetch failed").
    const url =
      urlOption || ev.env?.get("ZITADEL_URL") || PROCESS_ENV.ZITADEL_URL || "http://localhost:8080";
    const projectSecret =
      projectSecretOption ||
      ev.env?.get("ZITADEL_PROJECT_SECRET") ||
      PROCESS_ENV.ZITADEL_PROJECT_SECRET;
    const projectId =
      projectIdOption ??
      (ev.env?.get("ZITADEL_PROJECT_ID") ||
        ev.env?.get("PUBLIC_ZITADEL_PROJECT_ID") ||
        PROCESS_ENV.ZITADEL_PROJECT_ID ||
        PROCESS_ENV.PUBLIC_ZITADEL_PROJECT_ID);

    if (matchesRoutes(pathname, ignoredRoutes)) {
      return;
    }

    const route = proxyRoute(pathname, { proxyPath, projectId, loginPath });
    // An OAuth issuer that is not this app's project: the app answers, so its
    // origin never serves another project's issuer.
    if (route?.refused) {
      ev.send(refusedProxyResponse());
      return;
    }
    if (route) {
      ev.send(await proxyResponse(ev, url, route, projectId, projectSecret, proxyTimeoutMs));
      return;
    }

    await handleAuth(ev, {
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
}

/**
 * Reads the auth result that the handler left on the request.
 *
 * Call it in a `routeLoader$`, a `routeAction$` or an endpoint to learn who is signed in, and
 * use it to guard client-side navigations, which the handler's `protectedRoutes` does not cover.
 * It reads from {@link QwikRequestEvent.sharedMap}, so it works only after the handler from
 * {@link createZitadelOnRequest} ran earlier in the same request. When no handler ran, for
 * example on a path matched by `ignoredRoutes`, it returns the unauthenticated result rather
 * than throwing. An unauthenticated result also means that the check could not decide on a
 * route that is not protected, so do not treat it as proof that the user has no session. The result holds the session token, so do not return it from a loader to the
 * browser; return only the fields the page needs.
 *
 * Naming: Takes the framework's own request event or context and returns the verified result
 * that the handler stored on it. It reads and never creates, so it is called getAuth, and it is
 * synchronous because the framework has already handed over the event.
 *
 * @param ev - The current Qwik Router request event, or any object with a `sharedMap`.
 * @returns The current {@link AuthResult}, unauthenticated with a `null` session when the
 *   handler stored nothing.
 * @example
 * ```ts
 * import { routeLoader$ } from "@qwik.dev/router";
 * import { getAuth } from "@zitadel/sdk-qwik-router/server";
 *
 * export const useUser = routeLoader$((ev) => {
 *   const auth = getAuth(ev);
 *   if (!auth.isAuthenticated) {
 *     throw ev.redirect(302, "/login");
 *   }
 *   return auth.session.userId;
 * });
 * ```
 */
export function getAuth(ev: { sharedMap: Map<string, unknown> }): AuthResult {
  return (
    (ev.sharedMap.get(SHARED_MAP_KEY) as AuthResult | undefined) ?? {
      isAuthenticated: false,
      session: null,
    }
  );
}
