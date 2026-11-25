/**
 * The shared middleware layer of the server SDKs.
 *
 * It holds the constants and the framework-agnostic logic that every server SDK uses: route
 * matching, the login redirect, the header filter and cookie handling of the same-origin proxy,
 * and {@link resolveSession}, which judges who a request is signed in as. Keeping one
 * implementation here means the SDKs cannot drift apart on who counts as signed in.
 *
 * @packageDocumentation
 */

import type { JwtPayload } from "./jwt.js";

import { API_PREFIX, apiBaseUrl } from "@zitadel/api/runtime/base-url";
import { joinURL } from "ufo";

import { isJwtShaped, verifyJwt } from "./jwt.js";

/**
 * The names of the headers that a proxy must never forward to the upstream service.
 *
 * Most are connection-level headers that are meaningful only between two directly connected peers
 * and become invalid when proxied. Three are not hop-by-hop headers in the strict sense and are
 * listed on purpose: `accept-encoding`, because the proxy decodes the body that `fetch` returns, so
 * only the codings that `fetch` advertises itself may be chosen; `content-length`, because the
 * proxy re-sends a freshly buffered body and a forwarded value makes the fetch implementation
 * reject the request with an opaque "fetch failed"; and `host`, because the upstream host must come
 * from the upstream URL, or the SNI and virtual-host routing mismatch. All names are lower case.
 *
 * @example
 * ```ts
 * const forwarded = new Headers();
 * request.headers.forEach((value, name) => {
 *   if (!HOP_BY_HOP.has(name.toLowerCase()) && !INTERNAL_HEADERS.has(name.toLowerCase())) {
 *     forwarded.set(name, value);
 *   }
 * });
 * ```
 */
export const HOP_BY_HOP: ReadonlySet<string> = new Set([
  // accept-encoding is not hop-by-hop per RFC 7230, but the browser's value
  // must not reach the upstream: the proxy's fetch decodes the body it gets
  // back, so only the codings that fetch advertises itself may be chosen.
  "accept-encoding",
  "connection",
  // content-length is not hop-by-hop per RFC 7230, but it must be stripped: the
  // proxy re-sends a freshly buffered body, so the fetch implementation computes
  // the correct content-length itself. Forwarding the client's value is at best
  // redundant and at worst fatal — undici rejects a manually-set content-length
  // alongside a body with `UND_ERR_INVALID_ARG: invalid content-length header`,
  // which surfaced as an opaque "fetch failed" in the Qwik Router proxy.
  "content-length",
  // host is not a hop-by-hop header per RFC 7230, but it must be stripped so
  // the fetch implementation derives the correct Host from the upstream URL
  // rather than forwarding the client's Host and causing SNI/vhost mismatches.
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * The names of the SDK-internal headers that a proxy must never forward to the backend.
 *
 * These headers carry session data between the middleware and the server components of an app.
 * Forwarding one upstream would expose internal state and allow header injection. Treat the value
 * of such a header on an incoming request as untrusted: a client can send it, so a server
 * component must verify what it reads and never trust it as set by the middleware.
 */
export const INTERNAL_HEADERS: ReadonlySet<string> = new Set(["x-zitadel-auth-token"]);

/**
 * Returns whether a pathname matches at least one route pattern.
 *
 * An entry that ends with `*` matches any path that starts with the text before the `*`. All other
 * entries match exactly, ignoring a trailing slash on either side: `/profile` and `/profile/` name
 * the same route, and several frameworks, Qwik Router by default, serve the slashed form as the
 * canonical one. An exact comparison would let `/profile/` past a protected `/profile`. The
 * pathname is attacker-controlled, so the function trims slashes with a linear scan and not with a
 * regular expression that backtracks on a long run of slashes.
 *
 * A route matches when the raw pathname or the percent-decoded pathname matches. Frameworks route
 * on the decoded path, so `/%61dmin` reaches the page that `/admin` names, and a match on the raw
 * text alone would serve that page to a signed-out visitor. The path is decoded once, with
 * `decodeURI`, and never again: `/%2561dmin` decodes to `/%61dmin`, which names no route, and
 * `decodeURI` leaves reserved escapes such as `%2F` as they are. A malformed escape makes the
 * decoding throw, and the raw pathname alone is then matched. Dot segments are not collapsed, so
 * pass the pathname that the framework routes on.
 *
 * @param pathname - The URL pathname to test.
 * @param routes - The route patterns to match against.
 * @returns `true` when at least one pattern matches.
 *
 * @example
 * ```ts
 * matchesRoutes("/profile/", ["/profile"]); // true
 * matchesRoutes("/admin/users", ["/admin*"]); // true
 * matchesRoutes("/%61dmin", ["/admin*"]); // true
 * matchesRoutes("/public", ["/admin*"]); // false
 * ```
 */
export function matchesRoutes(pathname: string, routes: readonly string[]): boolean {
  // A linear scan, not /\/+$/: that regex backtracks quadratically on a long
  // run of slashes, and the pathname is attacker-controlled on every request.
  const withoutTrailingSlash = (path: string): string => {
    let end = path.length;
    while (end > 1 && path.charCodeAt(end - 1) === 0x2f) {
      end--;
    }
    return path.slice(0, end);
  };
  const decoded = ((): string => {
    try {
      return decodeURI(pathname);
    } catch {
      return pathname;
    }
  })();
  const candidates = decoded === pathname ? [pathname] : [pathname, decoded];

  return routes.some((route) => {
    if (route.endsWith("*")) {
      const prefix = route.slice(0, -1);
      return candidates.some((candidate) => {
        return candidate.startsWith(prefix);
      });
    }
    const expected = withoutTrailingSlash(route);
    return candidates.some((candidate) => {
      return withoutTrailingSlash(candidate) === expected;
    });
  });
}

/**
 * The name of the query parameter that carries the path of a signed-out request to the login page.
 *
 * The `<zitadel-login>` widget reads it and returns there after sign-in.
 */
const RETURN_PATH_PARAM = "next";

/**
 * Builds the address that a signed-out request for a protected route is redirected to.
 *
 * The result is the login path with the requested path and query string in the `next` parameter, so
 * that `<zitadel-login>` returns to the page as it was asked for, filters and tabs included. The
 * fragment never reaches the server, so it cannot be carried.
 *
 * A `next` that the request itself carries is left out, so a redirect never nests an earlier one:
 * should the login page be protected by mistake, each pass of the redirect loop would otherwise
 * wrap the last and grow the URL. The rest of the query keeps the encoding it was sent with.
 * Whatever query the login path has of its own is kept, except a `next`, which this replaces.
 *
 * The result is on the origin of the request, and the widget follows `next` only when it is a plain
 * path on its own origin, so the redirect cannot be turned into an open redirect.
 *
 * @param loginPath - The login page, a path that starts with a single `/`.
 * @param requestUrl - The full URL of the signed-out request.
 * @returns The URL to redirect to, on the origin of the request.
 *
 * @example
 * ```ts
 * loginRedirectUrl("/login", "https://app.example.com/reports?tab=open").toString();
 * // "https://app.example.com/login?next=%2Freports%3Ftab%3Dopen"
 * ```
 */
export function loginRedirectUrl(loginPath: string, requestUrl: string | URL): URL {
  // A copy made from the whole URL, never the caller's `search`: SvelteKit
  // makes `search` throw on the request event's URL while it prerenders.
  const requested = new URL(requestUrl);
  const query = requested.search
    .slice(1)
    .split("&")
    .filter((pair) => !new URLSearchParams(pair).has(RETURN_PATH_PARAM))
    .join("&");
  const loginUrl = new URL(loginPath, requested);
  loginUrl.searchParams.set(
    RETURN_PATH_PARAM,
    query === "" ? requested.pathname : `${requested.pathname}?${query}`,
  );
  return loginUrl;
}

/**
 * Returns the operation that a proxied path names: the path without the API prefix.
 *
 * `/api/v1/sessions/me` and `/sessions/me` name the same operation. Until version 1.0.0 the server
 * answers both spellings, so every check here that decides by path accepts both. A doubled prefix,
 * another version prefix and look-alikes such as `/api/v1x` are not the prefix and do not match.
 *
 * @param path - The path after the proxy prefix.
 * @returns The path without the API prefix.
 */
function operationPath(path: string): string {
  if (path === API_PREFIX) {
    return "/";
  }
  return path.startsWith(`${API_PREFIX}/`) ? path.slice(API_PREFIX.length) : path;
}

/**
 * Returns whether a proxied call may carry the confidential project secret.
 *
 * The browser flow needs the secret only for the handoff exchange, `POST /sessions/exchange`.
 * Adding it to every proxied operation would turn the public proxy boundary of the app into an
 * open relay that carries project-level authority for any anonymous caller, so a proxy asks this
 * function before it attaches the secret. The path matches with or without the API prefix.
 *
 * @param method - The HTTP method of the proxied request, in any case.
 * @param pathname - The path after the proxy prefix, for example `/sessions/exchange` or
 * `/api/v1/sessions/exchange`.
 * @returns `true` only for the handoff exchange.
 *
 * @example
 * ```ts
 * if (requiresProjectSecret(request.method, pathAfterProxyPrefix)) {
 *   headers.set("authorization", `Bearer ${projectSecret}`);
 * }
 * ```
 */
export function requiresProjectSecret(method: string, pathname: string): boolean {
  return method.toUpperCase() === "POST" && operationPath(pathname) === "/sessions/exchange";
}

// ─── Proxy routing ───────────────────────────────────────────────────────────

/**
 * The root path RFC 8414 §3.1 puts an issuer's metadata under. The path of the issuer itself
 * follows it.
 */
const AUTHORIZATION_SERVER_METADATA = "/.well-known/oauth-authorization-server";

/**
 * The path that every OAuth issuer of the server lives under, before its project id.
 */
const OAUTH_PREFIX = "/oauth";

/**
 * The only proxy path that the server builds an issuer from.
 */
const DEFAULT_PROXY_PATH = "/__nextgen";

/**
 * The messages that have been logged in this process.
 */
const warned = new Set<string>();

/**
 * Logs a message once per process on the server log of the app.
 *
 * @param message - The message to log, without the `[zitadel]` prefix.
 */
function warnOnce(message: string): void {
  if (warned.has(message)) {
    return;
  }
  warned.add(message);
  console.error(`[zitadel] ${message}`);
}

/**
 * What decides where the proxy sends a request.
 */
export interface ProxyRouteOptions {
  /**
   * The path prefix that the app proxies.
   *
   * @example "/__nextgen"
   */
  readonly proxyPath: string;
  /**
   * The project this app signs its users in to.
   */
  readonly projectId: string | undefined;
  /**
   * The login page of the app, a path that starts with a single `/`.
   */
  readonly loginPath: string;
}

/**
 * Where a request that the proxy handles goes.
 */
export interface ProxyRoute {
  /**
   * The path on the server, for example `/api/v1/flows`. It is empty for a request to the proxy
   * path itself.
   */
  readonly path: string;
  /**
   * Whether the proxy answers `404` itself and forwards nothing, because the path names an OAuth
   * issuer that is not the project of this app.
   */
  readonly refused: boolean;
  /**
   * The headers that tell the server how the request reached the app. Set them on the request to
   * the server and replace whatever the client sent under those names:
   *
   * - `x-forwarded-prefix`: the proxy path. The server builds the OAuth issuer from it, and the
   *   issuer must equal the URL that the client fetched (RFC 8414 §3.3).
   * - `x-zitadel-login-path`: the login page of the app, where the server sends an authorization
   *   request (ADR 081 §7). Only the path of `loginPath` goes, because the server accepts no query
   *   or fragment.
   */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Whether `path` is `prefix` or lies under it.
 *
 * @param path - The path to test.
 * @param prefix - The prefix to test against.
 * @returns `true` when the path is the prefix or continues it after a `/`.
 */
function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Returns where the proxy sends a request, or `undefined` when the request is not the proxy's.
 *
 * - A path under `proxyPath` goes to the server without the prefix.
 * - The RFC 8414 metadata of the OAuth issuer of the project sits outside the prefix. The issuer is
 *   `{origin}{proxyPath}/oauth/{projectId}`, so a client reads its metadata at
 *   `/.well-known/oauth-authorization-server{proxyPath}/oauth/{projectId}`, which goes to the
 *   `/.well-known/oauth-authorization-server/oauth/{projectId}` of the server. OpenID Connect
 *   Discovery needs no mapping: it sits under the issuer, and so under `proxyPath`.
 * - An OAuth path of another project, or of any project when the app has none, is refused. The
 *   server takes the origin of the issuer from the forwarded headers, so an app that forwarded the
 *   issuer of another project would lend that project its origin. The issuer of the platform
 *   project, `/oauth` itself, is never reached through an app either.
 *
 * @param pathname - The path of the request.
 * @param options - The proxy path, the project and the login page of the app.
 * @returns The route, or `undefined` when the request is not the proxy's.
 */
export function proxyRoute(pathname: string, options: ProxyRouteOptions): ProxyRoute | undefined {
  const { proxyPath, loginPath } = options;
  const headers = {
    "x-forwarded-prefix": proxyPath,
    "x-zitadel-login-path": loginPath.split(/[?#]/, 1)[0] ?? loginPath,
  };
  if (isUnder(pathname, proxyPath)) {
    const path = pathname.slice(proxyPath.length);
    const refused =
      isUnder(path, OAUTH_PREFIX) && !servesIssuer(options, (own) => isUnder(path, own));
    return { path, refused, headers };
  }
  const issuers = `${AUTHORIZATION_SERVER_METADATA}${proxyPath}${OAUTH_PREFIX}`;
  if (isUnder(pathname, issuers)) {
    const issuer = `${OAUTH_PREFIX}${pathname.slice(issuers.length)}`;
    return {
      path: `${AUTHORIZATION_SERVER_METADATA}${issuer}`,
      refused: !servesIssuer(options, (own) => issuer === own),
      headers,
    };
  }
  return undefined;
}

/**
 * Whether an OAuth path is the issuer of this app.
 *
 * It says once on the server log why the app is no issuer when its own setup is the reason: no
 * project is configured, or the proxy path is not the one that the server knows.
 *
 * @param options - The proxy path, the project and the login page of the app.
 * @param isOwn - Decides from the path of the issuer on the server whether the request names it.
 * @returns `true` when the request names the issuer of the project of this app.
 */
function servesIssuer(options: ProxyRouteOptions, isOwn: (ownIssuer: string) => boolean): boolean {
  const { proxyPath, projectId } = options;
  if (!projectId) {
    warnOnce(
      "No project id is configured, so this app's OAuth issuer answers 404. " +
        "Set ZITADEL_PROJECT_ID (or the `projectId` option) to the project this app signs its users in to.",
    );
    return false;
  }
  if (!isOwn(`${OAUTH_PREFIX}/${projectId}`)) {
    return false;
  }
  if (proxyPath !== DEFAULT_PROXY_PATH) {
    warnOnce(
      `The proxy path is "${proxyPath}", but the server serves a project's OAuth issuer only ` +
        `under "${DEFAULT_PROXY_PATH}", so this app's issuer answers 404. ` +
        "Leave `proxyPath` at its default to make this app an issuer.",
    );
  }
  return true;
}

/**
 * Builds the answer to a request that {@link proxyRoute} refuses.
 *
 * It is the `404` that the server gives for an issuer it does not serve, so a client reads the same
 * answer whether the app or the server refused. It never says why: the caller is anonymous, and the
 * server log of the app names a cause in the setup of the app.
 *
 * @returns The `404` response.
 */
export function refusedProxyResponse(): Response {
  return new Response(
    JSON.stringify({
      error: "invalid_request",
      error_description: "no authorization server at this issuer",
    }),
    {
      status: 404,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    },
  );
}

/**
 * Re-bases an upstream `Location` onto this app.
 *
 * Only the path, the query and the fragment survive. Whatever origin the upstream named is
 * discarded, and the result is based on the request's own URL. That keeps both properties that the
 * blanket removal of `Location` protected: an internal host name can never reach the browser, and
 * the redirect can only land on this app. It does so without knowing the public origin of the app,
 * which has no reliable source: `X-Forwarded-Host` can be set by an attacker on a direct request,
 * and the host of the request is wrong behind a proxy that terminates TLS or rewrites it. A
 * redirect to another origin becomes the same path on this one instead of being dropped, so a
 * deployment behind such a proxy works and does not land on a blank page.
 *
 * Nothing legitimate on this path points off-origin: an outbound redirect to an identity provider
 * travels as `step.redirect_url` in a JSON body and the widget performs it, never as a proxied
 * header. A relative reference resolves against the path it came from, so `next?flow=x` answered
 * to `/__nextgen/idp/google/callback` means `/__nextgen/idp/google/next?flow=x`. An unparseable
 * value has nothing to forward.
 *
 * @param location - The `Location` value of the upstream response.
 * @param selfUrl - The own request URL of the app.
 * @returns The re-based address, or `undefined` when there is nothing to forward.
 */
function ontoThisApp(location: string, selfUrl: string | undefined): string | undefined {
  if (selfUrl === undefined || selfUrl === "") {
    return undefined;
  }
  try {
    const base = new URL(selfUrl);
    const target = new URL(location, base);
    return new URL(`${target.pathname}${target.search}${target.hash}`, base).toString();
  } catch {
    return undefined;
  }
}

/**
 * Filters the headers of an upstream response for proxying.
 *
 * It removes the hop-by-hop headers, `content-encoding` and `set-cookie`, and it reduces `location`
 * to a redirect that can only land on this app. Cookies are handled separately, with
 * {@link proxySessionCookies}, because a response can carry several and the app must rewrite them.
 *
 * The `content-encoding` header describes the bytes that the upstream sent, but `fetch` has
 * already decoded them, so the proxy passes on a plain body. Forwarding the header would label that
 * body as compressed: the browser fails to decode it, and a successful answer, such as the session
 * exchange behind a compressing edge, reaches the caller as a request that got no response. The
 * `content-length` header goes for the same reason.
 *
 * The `location` header is kept only because the identity-provider callback needs it. The provider
 * returns the browser to `/__nextgen/idp/{slug}/callback`, and the server answers `303` back to the
 * page where the sign-in started. That is a top-level navigation with no JavaScript in the loop, so
 * a dropped `Location` leaves the browser on an empty page.
 *
 * @param upstream - The headers of the upstream response.
 * @param selfUrl - The own request URL of the app, which is both the origin that a redirect must
 * land on and the base that a relative one resolves against. When it is omitted, every redirect is
 * dropped.
 * @returns A new `Headers` object with the filtered headers.
 *
 * @example
 * ```ts
 * const upstream = await fetch(target, { headers: forwarded });
 * return new Response(upstream.body, {
 *   status: upstream.status,
 *   headers: filterResponseHeaders(upstream.headers, request.url),
 * });
 * ```
 */
export function filterResponseHeaders(upstream: Headers, selfUrl?: string): Headers {
  const filtered = new Headers();
  upstream.forEach((value, key) => {
    const name = key.toLowerCase();
    if (HOP_BY_HOP.has(name) || name === "content-encoding" || name === "set-cookie") {
      return;
    }
    if (name === "location") {
      const onThisApp = ontoThisApp(value, selfUrl);
      if (onThisApp !== undefined) {
        filtered.set("location", onThisApp);
      }
      return;
    }
    filtered.set(key, value);
  });
  return filtered;
}

/**
 * The prefix that a browser accepts only from this host, over a secure response.
 *
 * A cookie with this prefix cannot be planted by a sibling host, which is why the session cookie
 * carries it wherever it is `Secure`.
 */
const HOST_PREFIX = "__Host-";

/**
 * The name of the session cookie without the prefix, as it goes over plain http to a loopback host.
 *
 * Safari drops a `Secure` cookie on that transport, so the cookie has no `Secure` attribute there
 * and cannot carry the `__Host-` prefix.
 */
const LOOPBACK_SERVER_SESSION_COOKIE = "zitadel_session";

/**
 * The name of the server's session cookie, the canonical one that the server reads on every
 * request.
 *
 * A proxy sends a session upstream under this name only, whichever transport it reaches the server
 * over. In a browser the name depends on the transport; use {@link serverSessionCookieName} for the
 * name a browser holds.
 */
export const SERVER_SESSION_COOKIE = `${HOST_PREFIX}${LOOPBACK_SERVER_SESSION_COOKIE}`;

/**
 * Returns the name that the session cookie of the server has in a browser.
 *
 * It is the canonical {@link SERVER_SESSION_COOKIE} wherever the cookie is `Secure`, and
 * `zitadel_session` over plain http to a loopback host, where the cookie has no `Secure` attribute
 * for Safari and so cannot carry the `__Host-` prefix. On `localhost` the Console of a local server
 * keeps its session under this name.
 *
 * @param secure - Whether the cookie is `Secure`, that is whether the request is not plain http to
 * a loopback host.
 * @returns The cookie name.
 *
 * @example
 * ```ts
 * serverSessionCookieName(true); // "__Host-zitadel_session"
 * serverSessionCookieName(false); // "zitadel_session"
 * ```
 */
export function serverSessionCookieName(secure: boolean): string {
  return secure ? SERVER_SESSION_COOKIE : LOOPBACK_SERVER_SESSION_COOKIE;
}

/**
 * Returns the name of the cookie in which an app keeps the session of its project.
 *
 * The name is the server's name for the scheme of the app with the project id appended:
 * `__Host-zitadel_session_<project id>` wherever the cookie is `Secure`, and
 * `zitadel_session_<project id>` over plain http to a loopback host. A browser shares one cookie jar
 * across every port of a host, so under the name of the server alone the Console of a local server
 * and every app on `localhost` would hold their sessions in one slot and replace each other's.
 *
 * Every byte of the id outside `[A-Za-z0-9_-]` is percent-encoded, so any configured id makes a
 * valid cookie name. The ids that the server mints need no encoding.
 *
 * @param projectId - The project id that the app signs its users in to.
 * @param secure - Whether the cookie is `Secure`.
 * @returns The cookie name.
 *
 * @example
 * ```ts
 * sessionCookieName("296547382910273", true); // "__Host-zitadel_session_296547382910273"
 * sessionCookieName("296547382910273", false); // "zitadel_session_296547382910273"
 * ```
 */
export function sessionCookieName(projectId: string, secure: boolean): string {
  let name = `${serverSessionCookieName(secure)}_`;
  for (const byte of new TextEncoder().encode(projectId)) {
    const char = String.fromCharCode(byte);
    name += /[A-Za-z0-9_-]/.test(char)
      ? char
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return name;
}

/**
 * Returns whether a name is one of the server's session cookie names, on either transport.
 *
 * @param name - The cookie name.
 * @returns `true` for the canonical name and the loopback name.
 */
function isServerSessionCookie(name: string): boolean {
  return name === SERVER_SESSION_COOKIE || name === LOOPBACK_SERVER_SESSION_COOKIE;
}

/**
 * Returns whether a name is a session cookie: the server's or any app's own, under the name of
 * either transport.
 *
 * @param name - The cookie name.
 * @returns `true` for any session cookie.
 */
function isSessionCookie(name: string): boolean {
  const bare = name.startsWith(HOST_PREFIX) ? name.slice(HOST_PREFIX.length) : name;
  return (
    bare === LOOPBACK_SERVER_SESSION_COOKIE || bare.startsWith(`${LOOPBACK_SERVER_SESSION_COOKIE}_`)
  );
}

/**
 * A session cookie that a response sets.
 *
 * An empty value with a `maxAge` of zero clears the cookie. {@link serializeSessionCookie} turns it
 * into a `Set-Cookie` value. The result carries `Path=/`, `HttpOnly` and `SameSite=Lax`, and never
 * a `Domain`.
 */
export interface SessionCookie {
  /**
   * The name of the cookie.
   *
   * The session cookie of the app has the name that {@link sessionCookieName} returns.
   */
  readonly name: string;
  /**
   * The value of the cookie, the opaque session token.
   *
   * An empty string clears the cookie.
   */
  readonly value: string;
  /**
   * The number of seconds that the browser keeps the cookie.
   *
   * It is `undefined` for a cookie that lasts as long as the browser session, and `0` to clear the
   * cookie.
   */
  readonly maxAge: number | undefined;
  /**
   * Whether the cookie carries the `Secure` attribute. It is required for the
   * `__Host-` prefixed name, which browsers only accept over HTTPS.
   */
  readonly secure: boolean;
}

/**
 * Serializes a session cookie into a `Set-Cookie` value.
 *
 * The attributes are the ones that the server gives its own session cookie: `Path=/`, `HttpOnly`
 * and `SameSite=Lax`, plus `Max-Age` when the cookie has one and `Secure` when the cookie is
 * secure. `HttpOnly` keeps the token away from client JavaScript. The function does not escape the
 * value, so pass the opaque token as the server issued it.
 *
 * @param cookie - The cookie to serialize.
 * @returns The `Set-Cookie` header value.
 *
 * @example
 * ```ts
 * serializeSessionCookie({
 *   name: sessionCookieName("296547382910273", true),
 *   value: token,
 *   maxAge: 3600,
 *   secure: true,
 * });
 * ```
 */
export function serializeSessionCookie(cookie: SessionCookie): string {
  const attributes = [`${cookie.name}=${cookie.value}`, "Path=/"];
  if (cookie.maxAge !== undefined) {
    attributes.push(`Max-Age=${cookie.maxAge}`);
  }
  attributes.push("HttpOnly", "SameSite=Lax");
  if (cookie.secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

/**
 * The `Cache-Control` value for a response that sets a session cookie.
 *
 * It is the value that the server sends on its own session answers. A shared cache must not hand
 * the cookie, the session token that it carries or its clearing to the next visitor, so set this
 * header on every response that sets or clears a session cookie.
 */
export const SESSION_COOKIE_CACHE_CONTROL = "private, no-store";

/**
 * The request of the browser as the app sees it, and as a proxy in front of the app forwarded it.
 *
 * It decides whether a session cookie needs `Secure`: the scheme and host that a proxy in front of
 * the app forwarded win over the request URL, so an app behind a TLS proxy that talks to it over
 * loopback keeps `Secure`.
 */
export interface BrowserRequest {
  /**
   * The own request URL of the app.
   *
   * It is used when no forwarded header names the scheme or host. An unparseable value counts as
   * secure.
   */
  readonly requestUrl: string | URL;
  /**
   * The `X-Forwarded-Proto` header of the request, or `null` when absent.
   *
   * Only the first entry counts. Pass it only when the header comes from a proxy that you trust.
   */
  readonly forwardedProto?: string | null;
  /**
   * The `X-Forwarded-Host` header of the request, or `null` when absent.
   *
   * Only the first entry counts. Pass it only when the header comes from a proxy that you trust.
   */
  readonly forwardedHost?: string | null;
}

/**
 * Returns the first entry of a forwarded header that a chain of proxies appended to.
 *
 * @param value - The header value.
 * @returns The first non-empty entry, or `undefined`.
 */
function firstForwarded(value: string | null | undefined): string | undefined {
  const first = value?.split(",")[0]?.trim();
  return first ? first : undefined;
}

/**
 * Returns whether a session cookie that this app sets needs `Secure`.
 *
 * The rule is the one the server applies to its own cookie: always, except over plain http to a
 * loopback host, where Safari would drop a `Secure` cookie. The scheme and host are what a proxy in
 * front of the app forwarded, the first `X-Forwarded-Proto` and `X-Forwarded-Host`, else those of
 * the request URL of the app.
 *
 * @param request - The request of the browser.
 * @returns `true` when the cookie needs `Secure`.
 */
function secureFor(request: BrowserRequest): boolean {
  let url: URL;
  try {
    url = new URL(request.requestUrl);
  } catch {
    return true;
  }
  const proto = firstForwarded(request.forwardedProto) ?? url.protocol.slice(0, -1);
  if (proto.toLowerCase() !== "http") {
    return true;
  }
  let host: string;
  try {
    host = new URL(`http://${firstForwarded(request.forwardedHost) ?? url.host}`).hostname;
  } catch {
    return true;
  }
  host = host.toLowerCase();
  return !(host === "localhost" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host));
}

/**
 * Returns the seconds from now until a time, at least one, or `undefined` when the time is unknown.
 *
 * @param epochMs - The time in milliseconds since the Unix epoch.
 * @returns The number of seconds.
 */
function secondsUntil(epochMs: number): number | undefined {
  return Number.isFinite(epochMs)
    ? Math.max(1, Math.floor((epochMs - Date.now()) / 1000))
    : undefined;
}

/**
 * Builds the cookie that clears a session cookie.
 *
 * @param name - The cookie name.
 * @param secure - Whether the cookie is `Secure`.
 * @returns The clearing cookie.
 */
function clearedCookie(name: string, secure: boolean): SessionCookie {
  return { name, value: "", maxAge: 0, secure };
}

/**
 * Copies a session of this project that was found in the cookie of the server into the cookie of
 * the project.
 *
 * The cookie of the server keeps the session: on a server without platform bootstrap the Console
 * signs in to the project of the app, and clearing the cookie would sign the Console out. The proxy
 * retires the cookie of the server when the app signs a user in or out, see
 * {@link proxySessionCookies}, so it cannot sign the user back in once the cookie of the app is
 * gone.
 *
 * @param token - The opaque session token.
 * @param projectId - The project id.
 * @param maxAge - The lifetime in seconds, or `undefined`.
 * @param secure - Whether the cookie is `Secure`.
 * @returns The cookie to set.
 */
function copiedToProjectCookie(
  token: string,
  projectId: string,
  maxAge: number | undefined,
  secure: boolean,
): SessionCookie {
  return { name: sessionCookieName(projectId, secure), value: token, maxAge, secure };
}

/**
 * Rewrites a `Set-Cookie` of the server's session cookie into one of the app's own.
 *
 * The result keeps the value and the expiry under the given name, with the attributes of the scheme
 * of the app and not those that the server chose for its own transport. `Max-Age` wins over
 * `Expires`, as in a browser, and an `Expires` alone becomes the `Max-Age` that it amounts to.
 *
 * @param setCookie - The `Set-Cookie` value of the server.
 * @param name - The name of the cookie of the app.
 * @param secure - Whether the cookie is `Secure`.
 * @returns The `Set-Cookie` value for the browser.
 */
function projectSetCookie(setCookie: string, name: string, secure: boolean): string {
  const [pair = "", ...attributes] = setCookie.split(";");
  let maxAge: number | undefined;
  let expiresAt: number | undefined;
  for (const attribute of attributes) {
    const index = attribute.indexOf("=");
    const key = (index === -1 ? attribute : attribute.slice(0, index)).trim().toLowerCase();
    const value = index === -1 ? "" : attribute.slice(index + 1).trim();
    if (key === "max-age" && /^-?\d+$/.test(value)) {
      maxAge = Math.max(0, Number(value));
    } else if (key === "expires") {
      expiresAt = Date.parse(value);
    }
  }
  if (maxAge === undefined && expiresAt !== undefined && Number.isFinite(expiresAt)) {
    maxAge = expiresAt <= Date.now() ? 0 : secondsUntil(expiresAt);
  }
  const value = pair.slice(pair.indexOf("=") + 1).trim();
  return serializeSessionCookie({ name, value, maxAge, secure });
}

/**
 * Splits a `Cookie` header into its pieces, each with the name that it carries.
 *
 * @param header - The header value, or `null`.
 * @returns The pieces.
 */
function cookiePieces(header: string | null): { name: string; piece: string }[] {
  const pieces: { name: string; piece: string }[] = [];
  for (const raw of (header ?? "").split(";")) {
    const piece = raw.trim();
    if (piece !== "") {
      const index = piece.indexOf("=");
      pieces.push({ name: (index === -1 ? piece : piece.slice(0, index)).trim(), piece });
    }
  }
  return pieces;
}

/**
 * Returns the value of the first cookie with a name, or `null` when it is absent or empty.
 *
 * @param pieces - The pieces of a `Cookie` header.
 * @param name - The cookie name.
 * @returns The value, or `null`.
 */
function cookieValue(pieces: { name: string; piece: string }[], name: string): string | null {
  const found = pieces.find((candidate) => candidate.name === name);
  const value = found ? found.piece.slice(found.piece.indexOf("=") + 1).trim() : "";
  return value === "" ? null : value;
}

/**
 * Returns the name that a `Set-Cookie` value sets.
 *
 * @param setCookie - The `Set-Cookie` value.
 * @returns The cookie name, or an empty string.
 */
function setCookieName(setCookie: string): string {
  const index = setCookie.indexOf("=");
  return index === -1 ? "" : setCookie.slice(0, index).trim();
}

/**
 * What a proxied request carries that decides its session cookies.
 *
 * It extends {@link BrowserRequest}, whose request URL and forwarded headers decide whether a
 * cookie needs `Secure`. Build it from the request that the browser sent to the same-origin proxy.
 */
export interface ProxiedRequest extends BrowserRequest {
  /**
   * The HTTP method of the request that the browser sent to the same-origin proxy.
   *
   * The match is case-insensitive.
   */
  readonly method: string;
  /**
   * The path after the proxy prefix.
   *
   * It may carry the API prefix or not, for example `/sessions/me` or `/api/v1/sessions/me`.
   */
  readonly path: string;
  /**
   * The query string with its leading `?`, or an empty string.
   *
   * The `project_id` parameter of a session probe is read from it.
   */
  readonly search: string;
  /**
   * The `Cookie` header of the request, or `null` when absent.
   */
  readonly cookie: string | null;
}

/**
 * The server that a proxy forwards to, for the calls that the proxy makes of its own.
 *
 * Those calls ask the server about a session that is kept under the name of the server, and revoke
 * it on sign-out.
 */
export interface ProxyUpstream {
  /**
   * The base URL of the auth backend.
   *
   * A trailing slash and an existing API prefix are handled.
   *
   * @example "https://auth.example.com"
   */
  readonly url: string;
  /**
   * The time to wait for an answer, in milliseconds.
   *
   * A call that does not answer in time counts as having given no verdict, and the cookie stays.
   */
  readonly timeoutMs: number;
}

/**
 * What a proxied answer sends the browser.
 */
export interface ProxiedAnswer {
  /**
   * The `Set-Cookie` header values to send the browser, already serialized.
   */
  readonly setCookies: string[];
  /**
   * The body to send the browser.
   *
   * It is the upstream stream, or the text that this layer had to read. Send this body and never
   * the body of the upstream response, which this layer may already have consumed.
   */
  readonly body: ReadableStream<Uint8Array> | string | null;
}

/**
 * The session cookies of a proxied call, on the way up and on the way back.
 */
export interface ProxiedSessionCookies {
  /**
   * The `Cookie` header to send upstream, or `null` to send none.
   */
  readonly upstreamCookie: string | null;
  /**
   * The upstream answer's way back to the browser: the `Set-Cookie` values and
   * the body to send. Send this body, never the upstream response's own, which
   * this may have read.
   */
  toBrowser(upstream: Response): Promise<ProxiedAnswer>;
}

/**
 * Computes the session cookies of a call that the app proxies to the server.
 *
 * The server knows one session cookie, named by {@link serverSessionCookieName}. The app keeps the
 * session of its project in the cookie that {@link sessionCookieName} names, so it neither replaces
 * nor reads the session of another app or of the Console on the same host. Both names follow the
 * scheme of the app: the `__Host-` names wherever the cookie is `Secure`, and the unprefixed ones
 * over plain http to a loopback host. The app reads only the names of its scheme, because any
 * sibling host can plant an unprefixed cookie.
 *
 * - On the way up, the own session cookie of the app goes once, under the canonical
 *   {@link SERVER_SESSION_COOKIE}, and every other session cookie stays behind: both names of the
 *   server's and of every app's, and those of the earlier name. Other cookies pass unchanged.
 * - On the way back, a `Set-Cookie` of the server's session cookie under either
 *   name, which sets or clears it, becomes one of the app's own for its scheme:
 *   the value and expiry kept, `Path=/`, `HttpOnly`, `SameSite=Lax`, no
 *   `Domain`, and `Secure` as the app's scheme needs. A `Set-Cookie` of any
 *   other session cookie, one of the earlier name included, is dropped.
 * - A session kept under the server's name goes up to one call only, the session probe
 *   `GET /sessions/me?project_id=<project>`, which the server refuses for the session of another
 *   project. When the answer signs a user of this project in, the session is copied to the cookie
 *   of the app, and the cookie of the server keeps it, since the Console may share the project.
 * - When the app signs a user in, `POST /sessions/exchange`, or out, `DELETE /sessions/me`, a
 *   session that is still kept under the server's name is retired, or it would sign its user back
 *   in once the cookie of the app is gone. The server is asked about it in this project: a session
 *   of this project is cleared, and on sign-out also ended; a dead one is cleared; and one of
 *   another project, such as the Console's on `localhost`, is left alone.
 * - Each of these calls is known by its path with or without the API prefix `/api/v1`, which the
 *   server answers both ways until version 1.0.0.
 * - Without a project the cookies pass as they are, because nothing says which session is the
 *   session of the app.
 *
 * @param request - The proxied request.
 * @param projectId - The project id that the app signs its users in to.
 * @param upstream - The server that the proxy forwards to, which it asks about a session kept
 * under the server's name.
 * @returns The cookie to send upstream and a function that turns the upstream answer into what the
 * browser receives.
 *
 * @example
 * ```ts
 * const cookies = proxySessionCookies(
 *   {
 *     method: request.method,
 *     path: pathAfterProxyPrefix,
 *     search: url.search,
 *     cookie: request.headers.get("cookie"),
 *     requestUrl: request.url,
 *     forwardedProto: request.headers.get("x-forwarded-proto"),
 *     forwardedHost: request.headers.get("x-forwarded-host"),
 *   },
 *   "296547382910273",
 *   { url: "https://auth.example.com", timeoutMs: 5000 },
 * );
 * const upstream = await fetch(target, { headers: { cookie: cookies.upstreamCookie ?? "" } });
 * const answer = await cookies.toBrowser(upstream);
 * ```
 */
export function proxySessionCookies(
  request: ProxiedRequest,
  projectId: string | undefined,
  upstream: ProxyUpstream,
): ProxiedSessionCookies {
  if (!projectId) {
    return {
      upstreamCookie: request.cookie,
      toBrowser: async (upstream) => ({
        setCookies: upstream.headers.getSetCookie?.() ?? [],
        body: upstream.body,
      }),
    };
  }

  const secure = secureFor(request);
  const ownName = sessionCookieName(projectId, secure);
  const serverName = serverSessionCookieName(secure);
  const pieces = cookiePieces(request.cookie);
  const own = cookieValue(pieces, ownName);
  // A session kept under the server's name, which goes up to the probe only.
  const shared = cookieValue(pieces, serverName);
  const method = request.method.toUpperCase();
  const operation = operationPath(request.path);
  const isProbe =
    method === "GET" &&
    operation === "/sessions/me" &&
    new URLSearchParams(request.search).get("project_id") === projectId;
  const signsIn = method === "POST" && operation === "/sessions/exchange";
  const signsOut = method === "DELETE" && operation === "/sessions/me";
  const probed = own === null && isProbe ? shared : null;

  const sent = pieces.filter(({ name }) => !isSessionCookie(name)).map(({ piece }) => piece);
  const session = own ?? probed;
  if (session !== null) {
    sent.push(`${SERVER_SESSION_COOKIE}=${session}`);
  }

  return {
    upstreamCookie: sent.length > 0 ? sent.join("; ") : null,
    async toBrowser(answer) {
      const upstreamSetCookies = answer.headers.getSetCookie?.() ?? [];
      const setCookies: string[] = [];
      for (const setCookie of upstreamSetCookies) {
        const name = setCookieName(setCookie);
        if (isServerSessionCookie(name)) {
          setCookies.push(projectSetCookie(setCookie, ownName, secure));
        } else if (!isSessionCookie(name)) {
          setCookies.push(setCookie);
        }
      }
      // A sign-in that set the app's session, or any sign-out: the session the
      // server's cookie still holds goes too, unless it is another project's.
      const setsSession = upstreamSetCookies.some((setCookie) =>
        isServerSessionCookie(setCookieName(setCookie)),
      );
      if (shared !== null && (signsOut || (signsIn && answer.ok && setsSession))) {
        if (await retiresSharedSession(shared, projectId, upstream, signsOut)) {
          setCookies.push(serializeSessionCookie(clearedCookie(serverName, secure)));
        }
      }
      if (probed === null || answer.status !== 200) {
        return { setCookies, body: answer.body };
      }
      const body = await answer.text();
      const signedIn = sessionAnswer(parsedJson(body), projectId);
      if (
        signedIn.userId &&
        !setCookies.some((setCookie) => setCookieName(setCookie) === ownName)
      ) {
        const maxAge = signedIn.expiresAt
          ? secondsUntil(Date.parse(signedIn.expiresAt))
          : undefined;
        setCookies.push(
          serializeSessionCookie(copiedToProjectCookie(probed, projectId, maxAge, secure)),
        );
      }
      return { setCookies, body };
    },
  };
}

/**
 * Returns whether the session that is kept under the server's name goes when the app signs a user
 * in or out.
 *
 * The server is asked about the session in this project. A session of this project goes, and on
 * sign-out it is ended too, so that it cannot sign its user back in. One that the server no longer
 * holds goes as well. One of another project, such as the Console's on `localhost`, stays, and so
 * does one that the server gave no verdict on, and a JWT, which the middleware judges itself.
 *
 * @param token - The opaque session token.
 * @param projectId - The project id.
 * @param upstream - The server to ask.
 * @param signsOut - Whether the app signs the user out, which also revokes the session.
 * @returns `true` when the cookie of the server is cleared.
 */
async function retiresSharedSession(
  token: string,
  projectId: string,
  upstream: ProxyUpstream,
  signsOut: boolean,
): Promise<boolean> {
  if (isJwtShaped(token)) {
    return false;
  }
  const cookie = `${SERVER_SESSION_COOKIE}=${token}`;
  let res: Response;
  try {
    res = await fetch(
      `${joinURL(apiBaseUrl(upstream.url), "/sessions/me")}?project_id=${encodeURIComponent(projectId)}`,
      {
        method: "GET",
        headers: { cookie },
        signal: AbortSignal.timeout(upstream.timeoutMs),
      },
    );
  } catch {
    return false;
  }
  if (res.status === 401) {
    return true;
  }
  if (res.status === 404 || res.status === 403) {
    return (await errorCode(res)) === SESSION_NOT_FOUND;
  }
  if (!res.ok) {
    return false;
  }
  const answer = parsedJson(await res.text().catch(() => "")) as
    | { project_id?: unknown }
    | undefined;
  if (answer?.project_id !== projectId) {
    return false;
  }
  if (signsOut) {
    // A failed revoke still clears the cookie: the browser no longer holds the
    // session.
    await revokeSession(cookie, projectId, upstream);
  }
  return true;
}

/**
 * The name of the header that carries the CSRF token of the session.
 *
 * Sign-out is a write, so the server requires the token even for a call without an `Origin`.
 */
const CSRF_HEADER = "X-Zitadel-CSRF";

/**
 * Ends the session that a cookie carries, as the components package ends its own.
 *
 * Sign-out is a write, so it carries the CSRF token of the session, which it reads first from
 * `GET /sessions/me/csrf` in this project. A call without an `Origin` passes the cross-site check
 * of the server but not its token check. Without a token it sends no revoke, which the server would
 * refuse. A failure is swallowed, because the caller clears the cookie all the same.
 *
 * @param cookie - The `Cookie` header value that carries the session.
 * @param projectId - The project id.
 * @param upstream - The server to call.
 */
async function revokeSession(
  cookie: string,
  projectId: string,
  upstream: ProxyUpstream,
): Promise<void> {
  try {
    const res = await fetch(
      `${joinURL(apiBaseUrl(upstream.url), "/sessions/me/csrf")}?project_id=${encodeURIComponent(projectId)}`,
      {
        method: "GET",
        headers: { cookie },
        signal: AbortSignal.timeout(upstream.timeoutMs),
      },
    );
    const answer = res.ok
      ? (parsedJson(await res.text()) as { csrf_token?: unknown } | undefined)
      : undefined;
    if (typeof answer?.csrf_token !== "string") {
      return;
    }
    await fetch(joinURL(apiBaseUrl(upstream.url), "/sessions/me"), {
      method: "DELETE",
      headers: { cookie, [CSRF_HEADER]: answer.csrf_token },
      signal: AbortSignal.timeout(upstream.timeoutMs),
    });
  } catch {
    // No answer: the caller clears the cookie all the same.
  }
}

/**
 * Parses text as JSON.
 *
 * @param text - The text to parse.
 * @returns The parsed value, or `undefined` when the text is not JSON.
 */
function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The session of a signed-in user, as server code sees it.
 *
 * Identity follows the user-reference vocabulary of the API: render {@link ZitadelAuthSession.display},
 * fall back to {@link ZitadelAuthSession.identifier}, then to {@link ZitadelAuthSession.userId}. The
 * session carries the raw token for server-side use, so it must never be serialized into a page, a
 * server-rendered payload or a client fetch result. Convert it to a client-safe session without the token first.
 *
 * @example
 * ```ts
 * const name = session.display ?? session.identifier ?? session.userId;
 * ```
 */
export type ZitadelAuthSession = {
  /**
   * The unique identifier of the user, the `sub` claim.
   */
  userId: string;
  /**
   * The user schema's designated identifier value, the login identifier such as an email address
   * or a username, or `null` when it is unresolved.
   *
   * On the JWT path it carries the `email` claim.
   */
  identifier: string | null;
  /**
   * The schema property that the identifier came from, for example `"email"`, or `null` when it is
   * unknown.
   *
   * An identity from JWT claims carries no property attribution, so it is `null` there.
   */
  identifierProperty: string | null;
  /**
   * The display name rendering of the user, or `null` when the schema designates none.
   */
  display: string | null;
  /**
   * The raw session token.
   *
   * It is the verified JWT, or the opaque session token that the backend confirmed. It is a
   * credential: keep it on the server and out of any client payload.
   */
  token: string;
};

/**
 * The auth state of a user who is signed in.
 *
 * It is one half of {@link AuthResult}; check {@link AuthState.isAuthenticated} to narrow.
 */
export type AuthState = {
  /**
   * Always `true`.
   *
   * It is the discriminant that narrows an {@link AuthResult}.
   */
  isAuthenticated: true;
  /**
   * The verified session, including the raw token for server-side use.
   */
  session: ZitadelAuthSession;
};

/**
 * The auth state of a user who is not signed in.
 *
 * It is the other half of {@link AuthResult}. It is also what a request gets when the backend gave
 * no verdict on the session cookie; the session resolution reports that case separately.
 */
export type UnauthState = {
  /**
   * Always `false`.
   *
   * It is the discriminant that narrows an {@link AuthResult}.
   */
  isAuthenticated: false;
  /**
   * Always `null`, because there is no session to read.
   */
  session: null;
};

/**
 * The union of the possible auth states of a request, signed in or signed out.
 *
 * @example
 * ```ts
 * function greeting(auth: AuthResult): string {
 *   return auth.isAuthenticated ? `Hello ${auth.session.display ?? auth.session.userId}` : "Hello";
 * }
 * ```
 */
export type AuthResult = AuthState | UnauthState;

/**
 * The client-safe session that is exposed to the UI of an app, such as headers and account menus.
 *
 * It is identical to the session of a signed-in user on the server but omits the token: the raw session token must never
 * reach client-side JavaScript, whether through a server-rendered payload or a client fetch result.
 */
export type ClientSession = {
  /**
   * The unique identifier of the user, the `sub` claim.
   */
  userId: string;
  /**
   * The designated identifier value, the login identifier, or `null` when it is unresolved.
   */
  identifier: string | null;
  /**
   * The schema property that the identifier came from, or `null` when it is unknown.
   */
  identifierProperty: string | null;
  /**
   * The display name rendering of the user, or `null` when the schema designates none.
   */
  display: string | null;
};

/**
 * The client-safe auth state of a user who is signed in.
 */
export type ClientAuthState = {
  /**
   * Always `true`.
   *
   * It is the discriminant that narrows a {@link ClientAuthResult}.
   */
  isAuthenticated: true;
  /**
   * The identity of the signed-in user, without the raw token.
   */
  session: ClientSession;
};

/**
 * The union of the client-safe auth states.
 *
 * The client session reads return it, such as `getSession` in `@zitadel/sdk-core/session` and the
 * helpers that the framework SDKs re-export. The token is absent on purpose: use the server-side
 * helpers when the raw token is needed.
 *
 * @example
 * ```ts
 * const auth: ClientAuthResult = await getSession();
 * if (!auth.isAuthenticated) {
 *   showSignInButton();
 * }
 * ```
 */
export type ClientAuthResult = ClientAuthState | UnauthState;

/**
 * The options of the SDK middleware factory.
 *
 * Every server SDK passes them to `createZitadelMiddleware`, or to the equivalent of its
 * framework, so the options have one meaning everywhere. Every option is optional, but a project id
 * is needed for any session to count as signed in. The middleware resolves the session of each
 * request with `resolveSession`, serves the same-origin proxy under
 * {@link ZitadelMiddlewareOptions.proxyPath}, and redirects signed-out requests for protected
 * routes to the login page.
 *
 * @example
 * ```ts
 * const options: ZitadelMiddlewareOptions = {
 *   url: "https://auth.example.com",
 *   projectId: "296547382910273",
 *   protectedRoutes: ["/dashboard*", "/settings"],
 *   ignoredRoutes: ["/api/webhooks*"],
 *   loginPath: "/login",
 * };
 * ```
 */
export type ZitadelMiddlewareOptions = {
  /**
   * The full URL of the Zitadel auth backend.
   *
   * It is the issuer that JWTs are checked against, the host of the JWKS, and the target of the
   * same-origin proxy. A trailing slash is ignored.
   *
   * @defaultValue process.env.ZITADEL_URL, else "http://localhost:8080". An empty string counts
   * as unset.
   * @example "https://auth.example.com"
   */
  url?: string;

  /**
   * The project id that the app signs its users in to.
   *
   * A session counts as signed in only when it belongs to this project. A session of any other
   * project on the same server, such as a second app or the Console whose cookie the browser sends
   * to every port of a shared host, reads as signed out, and its cookie is left alone.
   *
   * The app keeps its session in a cookie of its own, `__Host-zitadel_session_<projectId>`, or
   * `zitadel_session_<projectId>` over plain http to a loopback host, so signing in here neither
   * replaces nor reads the session of another app or of the Console on the same host. The name is
   * what `sessionCookieName` returns.
   *
   * An opaque session token is checked by the backend, with
   * `GET /sessions/me?project_id=...`, and against the project that the answer names. A JWT must
   * name the project in its `aud` claim.
   *
   * It is required in practice: with no project, no session counts as signed in, a warning is
   * logged once, and the proxy passes the session cookie of the server through unchanged. Each SDK
   * falls back to the `ZITADEL_PROJECT_ID` environment variable, then to the public project id
   * variable of its framework, which `zitadel setup` writes to `.env.local`.
   *
   * @defaultValue process.env.ZITADEL_PROJECT_ID
   * @example "296547382910273"
   */
  projectId?: string;

  /**
   * The project secret, the service key of the project.
   *
   * The proxy sends it as the `Authorization: Bearer` header of the `POST /sessions/exchange`
   * call, the handoff that turns a sign-in into a session, and of no other request. A bearer that
   * the browser itself sends is kept and never replaced. The secret is for the server only: keep
   * it out of the build output and of any client bundle, so pass it from the environment of the
   * running server and never from a file that the build copies. An empty string counts as unset.
   * With no secret, the proxy sends no bearer and the handoff cannot be exchanged.
   *
   * @defaultValue process.env.ZITADEL_PROJECT_SECRET
   * @example process.env.ZITADEL_PROJECT_SECRET
   */
  projectSecret?: string;

  /**
   * The URL path prefix that is reverse-proxied to the auth backend.
   *
   * The widgets call this prefix on the origin of the app, so the session cookie is first-party and
   * no CORS setup is needed. Keep it equal to the `proxyPath` of the widgets. Sign-in with an
   * external identity provider currently requires the default, because the provider returns to
   * `/__nextgen/idp/{slug}/callback`, which is proxied only under the default prefix. So does the
   * OAuth issuer of the project, `{origin}/__nextgen/oauth/{projectId}`: the proxy also serves its
   * metadata at `/.well-known/oauth-authorization-server/__nextgen/oauth/{projectId}`, and answers
   * `404` for an OAuth path of any other project (`proxyRoute` in `@zitadel/sdk-core`).
   *
   * @defaultValue "/__nextgen"
   * @example "/__nextgen"
   */
  proxyPath?: string;

  /**
   * The pathnames that require a valid session.
   *
   * A request to one of these routes without a valid session is redirected to
   * {@link ZitadelMiddlewareOptions.loginPath}, with the requested path in the `next` query
   * parameter. An entry that ends with `*` matches any sub-path, for example `"/admin*"`. An entry
   * without it matches exactly, with or without a trailing slash. Matching is done by
   * `matchesRoutes`.
   *
   * When the backend cannot say whether a session cookie is live, because it answers `5xx`, does
   * not answer in time or cannot be reached, the route answers `503 Service Unavailable` and does
   * not redirect: the user may well be signed in, and the login page would tell them they are not.
   *
   * Some SDKs ask the backend about an opaque session only on these routes and leave the check to
   * the render layer elsewhere, so a route that is not listed is not guarded by the middleware.
   * List every route that must be private.
   *
   * @defaultValue []
   * @example ["/dashboard*", "/settings"]
   */
  protectedRoutes?: string[];

  /**
   * The pathnames that the middleware skips completely.
   *
   * A skipped route gets no JWT verification, no protection check and no header tunnelling. Use it
   * for webhooks, health-check endpoints and any other route where running auth logic is
   * undesirable. An entry that ends with `*` matches any sub-path, for example `"/public*"`. A
   * route listed here is unauthenticated, so never put a route there that reads a session.
   *
   * @defaultValue []
   * @example ["/api/webhooks*", "/healthz"]
   */
  ignoredRoutes?: string[];

  /**
   * The pathname that unauthenticated users are redirected to.
   *
   * The redirect carries the requested path and query string in the `next` query parameter, and
   * `<zitadel-login>` returns there after sign-in. The login page itself must not be a protected
   * route. The proxy tells the server this path on every request, without its query, and the
   * server sends an OAuth authorization request there.
   *
   * @defaultValue "/login"
   * @example "/sign-in"
   */
  loginPath?: string;

  /**
   * A local PEM public key for offline JWT verification.
   *
   * It is reserved for future use and has no effect today: JWTs are verified against the JWKS of
   * the backend.
   *
   * @defaultValue undefined
   * @example "-----BEGIN PUBLIC KEY-----..."
   */
  jwtKey?: string;

  /**
   * The accepted values of the JWT `alg` header.
   *
   * A token whose algorithm is not in the list is rejected before the JWKS is fetched. The `none`
   * algorithm is always rejected.
   *
   * @defaultValue ["RS256", "ES256"]
   * @example ["ES256"]
   */
  allowedAlgorithms?: string[];

  /**
   * The clock-skew tolerance in milliseconds.
   *
   * It applies to the validation of the `exp`, `nbf` and `iat` claims, so a small difference
   * between the clocks of the issuer and the app does not reject a valid token.
   *
   * @defaultValue 5000
   * @example 10000
   */
  clockSkewMs?: number;

  /**
   * The expected value or values of the `aud` claim.
   *
   * When it is omitted, the audience is not validated by the token check. Pass a single string, or
   * an array when a token may carry several audiences. The project check of the session is
   * separate: a JWT must always name the project in its `aud`.
   *
   * @defaultValue undefined
   * @example "296547382910273"
   */
  audience?: string | string[];

  /**
   * The accepted values of the JWT `typ` header, compared case-insensitively.
   *
   * A token whose `typ` is not in the list is rejected. It guards against the use of another kind
   * of token where an access token is expected. Set it to `[]` to disable the check.
   *
   * @defaultValue ["JWT", "at+JWT"]
   */
  allowedTokenTypes?: string[];

  /**
   * The timeout of a JWKS request, in milliseconds.
   *
   * A request that does not complete within the window is aborted, and the token is rejected, so
   * the request counts as unauthenticated.
   *
   * @defaultValue 5000
   * @example 2000
   */
  jwksTimeoutMs?: number;

  /**
   * The timeout of an upstream proxy request, in milliseconds.
   *
   * A request that does not complete within the window is aborted with a network error.
   *
   * @defaultValue 5000
   * @example 10000
   */
  proxyTimeoutMs?: number;

  /**
   * The timeout, in milliseconds, of the validation of an opaque session token.
   *
   * The validation is a call to `GET /sessions/me` at the backend. A token that the backend does not
   * answer for within this window is not refused: the request counts as signed out, its session
   * cookie is kept, and a protected route answers `503`, see
   * {@link ZitadelMiddlewareOptions.protectedRoutes}. A slow backend therefore never signs users
   * out.
   *
   * @defaultValue 5000
   * @example 3000
   */
  opaqueTokenTimeoutMs?: number;
};

/**
 * What the backend reports for an opaque, non-JWT, session token.
 *
 * The user id is `null` when the session names no user of the project of this app. That is an
 * anonymous session, because the server sets the session cookie before any user factor is verified,
 * so an abandoned or in-progress sign-in holds a live session that names no user. It is also a live
 * session of another project. Such a session is not signed in, but it is not dead either, so
 * callers keep its cookie and do not clear it: an anonymous sign-in may still complete, and the
 * session of the other project belongs to the app that signed it in.
 */
export interface OpaqueSession {
  /**
   * The id of the signed-in user in the project of this app.
   *
   * It is `null` for an anonymous session and for a session of another project.
   */
  readonly userId: string | null;
  /**
   * The login identifier of the user, for example an email address, or `null`.
   */
  readonly identifier: string | null;
  /**
   * The schema property that {@link OpaqueSession.identifier} came from, for example `"email"`, or
   * `null`.
   */
  readonly identifierProperty: string | null;
  /**
   * The display name rendering of the user, or `null` when the schema designates none.
   */
  readonly display: string | null;
  /**
   * The time at which the session expires, as the backend reports it, or `null`.
   *
   * The lifetime of the cookie that the middleware sets follows it.
   */
  readonly expiresAt: string | null;
}

/**
 * The error code that the backend answers a session read with when the session belongs to another
 * project than the one that the read names.
 *
 * A client treats an answer with this code as a live session that signs no one in, and keeps the
 * cookie.
 */
export const SESSION_PROJECT_MISMATCH = "sess.project_mismatch";

/**
 * Returns a live session that names no user of the project of this app.
 *
 * @returns The session.
 */
function noUser(): OpaqueSession {
  return {
    userId: null,
    identifier: null,
    identifierProperty: null,
    display: null,
    expiresAt: null,
  };
}

/**
 * Reads what a `GET /sessions/me` answer says about the project of this app.
 *
 * A session of another project names no user here. A backend that predates the `project_id`
 * parameter answers for any project, so the project that the answer names is checked too.
 *
 * @param body - The parsed answer.
 * @param projectId - The project id of this app.
 * @returns The session.
 */
function sessionAnswer(body: unknown, projectId: string): OpaqueSession {
  const answer = (typeof body === "object" && body !== null ? body : {}) as {
    project_id?: unknown;
    user_id?: unknown;
    expires_at?: unknown;
    user?: { identifier?: unknown; identifier_property?: unknown; display?: unknown };
  };
  if (answer.project_id !== projectId) {
    return noUser();
  }
  const text = (value: unknown): string | null =>
    typeof value === "string" && value !== "" ? value : null;
  return {
    userId: text(answer.user_id),
    identifier: text(answer.user?.identifier),
    identifierProperty: text(answer.user?.identifier_property),
    display: text(answer.user?.display),
    expiresAt: text(answer.expires_at),
  };
}

/**
 * The verdict of the backend on an opaque session token, from {@link checkOpaqueSessionToken}.
 *
 * - `live`: the backend holds a live session for the token. Its user id is `null` when the session
 *   names no user of the project of this app, because it is an anonymous one or one of another
 *   project, see {@link OpaqueSession}.
 * - `refused`: the backend judged the token and refused it with `401`, or found the session that it
 *   names gone, with `404` and the `sess.not_found` code. Only this verdict makes the cookie dead.
 * - `undecided`: the backend gave no verdict. The cause is a `5xx` or any other answer, no answer
 *   in time, a network error, or a body that cannot be read. The backend answers `500`, never
 *   `401`, when it cannot decide, for example because its token or key store failed, so that an
 *   outage does not sign its users out. The request counts as signed out, but the cookie is kept.
 */
export type OpaqueSessionCheck =
  | {
      /**
       * The backend holds a live session for the token.
       */
      readonly verdict: "live";
      /**
       * What the backend reports about that session.
       */
      readonly session: OpaqueSession;
    }
  | {
      /**
       * The backend judged the token and refused it, so the cookie is dead.
       */
      readonly verdict: "refused";
    }
  | {
      /**
       * The backend gave no verdict, so the cookie is kept.
       */
      readonly verdict: "undecided";
    };

/**
 * The error code that the backend answers `GET /sessions/me` with when the session is gone.
 */
const SESSION_NOT_FOUND = "sess.not_found";

/**
 * The error code that the backend answers a path with when no operation of its version has it.
 *
 * Seen on a session check, it means that the server is older than the SDK and does not serve the
 * API under its prefix.
 */
const ROUTE_NOT_FOUND = "req.not_found";

/**
 * Asks the backend whether an opaque session token names a live session in the project of this app,
 * and tells a refusal apart from no verdict.
 *
 * The call is `GET {issuerUrl}/api/v1/sessions/me?project_id={projectId}`. It exists because the
 * server SDKs must clear a session cookie only when the backend refuses it: an earlier version
 * cleared the cookie on any failed check, so a database blip or a slow backend signed every user
 * out. The backend deliberately answers `500`, never `401`, when it cannot decide, and this
 * function keeps that distinction.
 *
 * A live session of another project comes back with no user, like an anonymous one: it signs no
 * one in here, and its cookie is not dead. The backend refuses such a session itself, with `403`
 * and `sess.project_mismatch`, and the project that its answer names is checked as well, because a
 * backend that predates the parameter answers for any project. The tokens that belong to another
 * project are remembered for five minutes, so a request that is signed out here does not ask again
 * about the session that another app, or on `localhost` the Console, keeps under the cookie of the
 * server. The memo holds a hash of the token and never the token.
 *
 * A `404` is a refusal only with the `sess.not_found` code. With `req.not_found` the backend knows
 * no such operation, which means that it is older than this SDK and does not serve the API under
 * its prefix. Without a code, the answer came from something in front of the backend, such as a
 * proxy or a URL with the wrong path. Neither judged anything.
 *
 * When there is no verdict, the function logs why with `console.warn`. The request then renders
 * signed out, or answers `503` on a protected route, and nothing else would say what went wrong.
 *
 * @param token - The opaque session token from the session cookie of the app.
 * @param issuerUrl - The base URL of the auth backend.
 * @param timeoutMs - How long to wait for the backend before giving up, in milliseconds.
 * @param projectId - The project id that the app signs its users in to. Without one, no session can
 * be shown to belong here: the backend is not asked, and the session reads as live with no user, so
 * its cookie is kept.
 * @returns The verdict of the backend.
 *
 * @example
 * ```ts
 * const check = await checkOpaqueSessionToken(token, "https://auth.example.com", 5000, projectId);
 * if (check.verdict === "refused") {
 *   clearSessionCookie();
 * }
 * ```
 */
export async function checkOpaqueSessionToken(
  token: string,
  issuerUrl: string,
  timeoutMs: number,
  projectId: string,
): Promise<OpaqueSessionCheck> {
  if (!projectId) {
    return { verdict: "live", session: noUser() };
  }
  const key = await otherProjectKey(token, projectId);
  if (otherProjectSessions.knows(key)) {
    return { verdict: "live", session: noUser() };
  }
  const endpoint = joinURL(apiBaseUrl(issuerUrl), "/sessions/me");
  try {
    const res = await fetch(`${endpoint}?project_id=${encodeURIComponent(projectId)}`, {
      method: "GET",
      headers: { cookie: `${SERVER_SESSION_COOKIE}=${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401) {
      return { verdict: "refused" };
    }
    if (res.status === 404) {
      const code = await errorCode(res);
      if (code === SESSION_NOT_FOUND) {
        return { verdict: "refused" };
      }
      if (code === ROUTE_NOT_FOUND) {
        return undecided(
          endpoint,
          `HTTP 404 ${ROUTE_NOT_FOUND}: the server has no such operation; a server older than this SDK does not serve the API under ${API_PREFIX}`,
        );
      }
    }
    if (res.status === 403 && (await errorCode(res)) === SESSION_PROJECT_MISMATCH) {
      otherProjectSessions.remember(key);
      return { verdict: "live", session: noUser() };
    }
    if (!res.ok) {
      return undecided(endpoint, `HTTP ${res.status}`);
    }
    const body: unknown = await res.json();
    if ((body as { project_id?: unknown } | null)?.project_id !== projectId) {
      otherProjectSessions.remember(key);
    }
    return { verdict: "live", session: sessionAnswer(body, projectId) };
  } catch (err) {
    return undecided(endpoint, failureCause(err, timeoutMs));
  }
}

/**
 * The opaque session tokens that the backend placed in another project.
 *
 * A request that is signed out here does not ask again about the session that another app, or on
 * `localhost` the Console, keeps under the cookie of the server, because a session never changes
 * its project. Each token is remembered for a while, and only so many tokens are kept.
 */
const otherProjectSessions = (() => {
  const TTL_MS = 5 * 60_000;
  const MAX_ENTRIES = 1024;
  const known = new Map<string, number>();
  return {
    knows(key: string): boolean {
      const until = known.get(key);
      if (until === undefined) {
        return false;
      }
      if (until > Date.now()) {
        return true;
      }
      known.delete(key);
      return false;
    },
    remember(key: string): void {
      known.delete(key);
      known.set(key, Date.now() + TTL_MS);
      if (known.size > MAX_ENTRIES) {
        const oldest = known.keys().next().value;
        if (oldest !== undefined) {
          known.delete(oldest);
        }
      }
    },
    clear(): void {
      known.clear();
    },
  };
})();

/**
 * Returns the memo key of a token in a project.
 *
 * The key is a hash, so that the memo holds no session token.
 *
 * @param token - The session token.
 * @param projectId - The project id.
 * @returns The key.
 */
async function otherProjectKey(token: string, projectId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `${projectId}:${hex}`;
}

/**
 * Forgets which session tokens the backend placed in another project.
 *
 * {@link checkOpaqueSessionToken} remembers them for a while. Call it in tests that answer for the
 * same token differently.
 */
export function clearSessionCheckCache(): void {
  otherProjectSessions.clear();
}

/**
 * Validates an opaque session token by asking the backend whether the session is live in the
 * project of this app.
 *
 * The call is `GET {issuerUrl}/api/v1/sessions/me?project_id={projectId}`. The value `null` folds a
 * refusal and no verdict together, so it says whether the request is signed in and not whether the
 * cookie is dead. Clearing the cookie on `null` signs users out whenever the backend fails. To
 * decide that, use {@link checkOpaqueSessionToken}.
 *
 * @param token - The opaque session token from the session cookie of the app.
 * @param issuerUrl - The base URL of the auth backend.
 * @param timeoutMs - How long to wait for the backend before giving up, in milliseconds.
 * @param projectId - The project id that the app signs its users in to.
 * @returns The live session, with a `null` user id when it names no user of this project, or `null`
 * when the backend did not confirm one because it refused the token or gave no verdict.
 *
 * @example
 * ```ts
 * const session = await validateOpaqueSessionToken(token, issuerUrl, 5000, projectId);
 * const signedIn = session?.userId != null;
 * ```
 */
export async function validateOpaqueSessionToken(
  token: string,
  issuerUrl: string,
  timeoutMs: number,
  projectId: string,
): Promise<OpaqueSession | null> {
  const check = await checkOpaqueSessionToken(token, issuerUrl, timeoutMs, projectId);
  return check.verdict === "live" ? check.session : null;
}

/**
 * Reads the `code` of an error envelope.
 *
 * @param res - The response to read.
 * @returns The code, or `undefined` when the body is not an error envelope.
 */
async function errorCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { code?: unknown };
    return typeof body.code === "string" ? body.code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Describes why a session check failed, for the log.
 *
 * @param err - The error that the call threw.
 * @param timeoutMs - The timeout of the call.
 * @returns The cause as text.
 */
function failureCause(err: unknown, timeoutMs: number): string {
  if ((err as { name?: unknown } | null)?.name === "TimeoutError") {
    return `no answer within ${timeoutMs} ms`;
  }
  // A failed fetch says only "fetch failed"; what failed is in its cause.
  const cause = (err as { cause?: unknown } | null)?.cause;
  return cause instanceof Error ? `${String(err)}: ${cause.message}` : String(err);
}

/**
 * Logs why the backend gave no verdict on a session cookie, and returns that verdict.
 *
 * @param endpoint - The endpoint that was called.
 * @param cause - Why there is no verdict.
 * @returns The `undecided` verdict.
 */
function undecided(endpoint: string, cause: string): OpaqueSessionCheck {
  console.warn(
    `[zitadel] Could not check the session cookie against ${endpoint} (${cause}). ` +
      "That is not a refusal: the request counts as signed out, and the cookie is kept.",
  );
  return { verdict: "undecided" };
}

/**
 * Returns whether a verified JWT names a project in its `aud` claim.
 *
 * The audience is the one place where a self-contained token can say which project it was issued
 * for, so a JWT signs a user in only when it names the project of the app. An empty project id
 * never matches.
 *
 * @param payload - The verified payload.
 * @param projectId - The project id of the app.
 * @returns `true` when the audience contains the project id.
 *
 * @example
 * ```ts
 * jwtNamesProject({ aud: ["296547382910273"] }, "296547382910273"); // true
 * ```
 */
export function jwtNamesProject(payload: JwtPayload, projectId: string): boolean {
  const audience = payload.aud === undefined ? [] : [payload.aud].flat();
  return projectId !== "" && audience.includes(projectId);
}

/**
 * What a request carries that decides its session.
 *
 * It extends {@link BrowserRequest}, whose request URL and forwarded headers decide whether a
 * cookie needs `Secure`.
 */
export interface SessionRequest extends BrowserRequest {
  /**
   * The `Authorization: Bearer` token, or `null` when absent.
   *
   * It takes precedence: when it signs a user of this project in, the cookie is not consulted. It is
   * judged as a JWT only, and a bearer token that is not a JWT of this project leaves the cookie to
   * be judged on its own.
   */
  readonly bearer: string | null;
  /**
   * Reads one of the cookies of the request by name.
   *
   * It returns `null` or `undefined` when the cookie is absent.
   */
  readonly cookie: (name: string) => string | null | undefined;
}

/**
 * The settings that {@link resolveSession} judges the session of a request by.
 *
 * The server SDKs build it from {@link ZitadelMiddlewareOptions} after they apply the defaults, so
 * each field here has the meaning of the option of the same name.
 */
export interface ResolveSessionOptions {
  /**
   * The base URL of the auth backend, which is the issuer that the session is checked against.
   */
  readonly url: string;
  /**
   * The project id that the app signs its users in to.
   *
   * With `undefined`, no session counts as signed in. See {@link ZitadelMiddlewareOptions.projectId}.
   */
  readonly projectId: string | undefined;
  /**
   * The accepted JWT signing algorithms.
   *
   * With `undefined`, the verifier accepts every algorithm that it supports.
   */
  readonly allowedAlgorithms: readonly string[] | undefined;
  /**
   * The clock difference, in milliseconds, that is tolerated when `exp` and `nbf` are checked.
   */
  readonly clockSkewMs: number;
  /**
   * The `aud` value or values that a JWT must carry.
   *
   * With `undefined`, the audience check of the token is skipped. The project check still applies.
   */
  readonly audience: string | readonly string[] | undefined;
  /**
   * The accepted values of the JWT `typ` header, so that a token minted for another purpose is
   * refused.
   */
  readonly allowedTokenTypes: readonly string[];
  /**
   * How long to wait for the JWKS document, in milliseconds.
   *
   * With `undefined`, the verifier uses its default of 5000.
   */
  readonly jwksTimeoutMs: number | undefined;
  /**
   * How long to wait for the backend to judge an opaque token, in milliseconds.
   *
   * A token that is not judged in time counts as undecided and its cookie is kept.
   */
  readonly opaqueTokenTimeoutMs: number;
  /**
   * Whether an opaque session cookie is checked with the backend, a call to
   * the server on every request. `false` leaves it to a render layer that
   * checks the session itself, as sdk-next's `auth()` does: the result hands
   * the token on as {@link ResolvedSession.unchecked}. A JWT is judged either
   * way, without a call.
   *
   * Use `false` in a framework whose middleware runs on every route, including prefetches, so that
   * a signed-in visitor does not cost a backend call on every page. Protected routes should still
   * check, because they decide between a redirect and a `503`.
   *
   * @defaultValue true
   */
  readonly checkOpaqueSession?: boolean;
}

/**
 * The session of a request, as {@link resolveSession} judged it.
 */
export interface ResolvedSession {
  /**
   * Whether the request is signed in, and as whom.
   */
  readonly auth: AuthResult;
  /**
   * Whether the backend gave no verdict on the session cookie
   * ({@link OpaqueSessionCheck}). The request counts as signed out and the
   * cookie is kept; a protected route answers `503` rather than send a user
   * who may well be signed in to the login page.
   */
  readonly undecided: boolean;
  /**
   * The session cookies the response sets, with {@link SESSION_COOKIE_CACHE_CONTROL}
   * when there are any. A cookie the backend refused is cleared so the browser
   * stops sending it; a session of this project found in the server's cookie is
   * copied to the project's own, and the server's cookie keeps it, since the
   * Console may share the project. No other cookie is
   * touched: a session that is live but signs no one in here (an anonymous
   * one, or one of another project) keeps its cookie, and so does one the
   * backend gave no verdict on, and one behind a Bearer token that signed the
   * request in, which was never judged.
   */
  readonly cookies: readonly SessionCookie[];
  /**
   * The opaque session token the backend was not asked about, when
   * {@link ResolveSessionOptions.checkOpaqueSession} is `false`. The request
   * counts as signed out here and its cookie is left as it is: whatever reads
   * the session next checks the token itself.
   */
  readonly unchecked?: string;
}

/**
 * Returns the signed-out auth state.
 *
 * @returns The state.
 */
function signedOut(): UnauthState {
  return { isAuthenticated: false, session: null };
}

/**
 * Logs once per process why no session counts: no project id is configured.
 */
function warnMissingProject(): void {
  warnOnce(
    "No project id is configured, so no session counts as signed in. " +
      "Set ZITADEL_PROJECT_ID (or the `projectId` option) to the project this app signs its users in to.",
  );
}

/**
 * Finds the cookie that the session of a request is read from.
 *
 * Only the names of the scheme of the request are tried: the project's own, which
 * {@link sessionCookieName} returns, else the server's, which {@link serverSessionCookieName}
 * returns and where, on `localhost`, the Console keeps its own. Over https an unprefixed cookie is
 * never read, because any sibling host can plant one.
 *
 * @param cookie - Reads a cookie by name.
 * @param projectId - The project id.
 * @param secure - Whether the cookie is `Secure`.
 * @returns The cookie name and token, or `null` when there is none.
 */
function storedSession(
  cookie: SessionRequest["cookie"],
  projectId: string,
  secure: boolean,
): { readonly name: string; readonly token: string } | null {
  for (const name of [sessionCookieName(projectId, secure), serverSessionCookieName(secure)]) {
    const token = cookie(name);
    if (token) {
      return { name, token };
    }
  }
  return null;
}

/**
 * What {@link judgeJwt} makes of a JWT: who it signs in, whether a cookie that holds it is dead, and
 * how long it lives.
 */
interface JwtVerdict {
  /**
   * Who the JWT signs in.
   */
  readonly auth: AuthResult;
  /**
   * Whether a cookie that holds the JWT is dead, so that the browser can drop it.
   */
  readonly dead: boolean;
  /**
   * The seconds until a JWT that signs its user in expires, if it says.
   */
  readonly maxAge: number | undefined;
}

/**
 * Judges a JWT.
 *
 * It signs its `sub` in when it verifies and its `aud` names this project. Held in a cookie, it is
 * dead when it fails verification or names no user of this project. A verified JWT of another
 * project is live there, so its cookie stays.
 *
 * @param token - The token.
 * @param projectId - The project id of the app.
 * @param options - The settings.
 * @returns The verdict.
 */
async function judgeJwt(
  token: string,
  projectId: string,
  options: ResolveSessionOptions,
): Promise<JwtVerdict> {
  const payload = isJwtShaped(token)
    ? await verifyJwt(token, {
        issuerUrl: options.url,
        allowedAlgorithms: options.allowedAlgorithms,
        clockSkewMs: options.clockSkewMs,
        audience: options.audience,
        allowedTokenTypes: options.allowedTokenTypes,
        jwksTimeoutMs: options.jwksTimeoutMs,
      })
    : null;
  if (!payload) {
    return { auth: signedOut(), dead: true, maxAge: undefined };
  }
  const namesProject = jwtNamesProject(payload, projectId);
  if (!payload.sub || !namesProject) {
    return { auth: signedOut(), dead: namesProject, maxAge: undefined };
  }
  return {
    auth: {
      isAuthenticated: true,
      session: {
        userId: payload.sub,
        identifier: payload.email ?? null,
        identifierProperty: null,
        display: payload.name ?? null,
        token,
      },
    },
    dead: false,
    maxAge: payload.exp === undefined ? undefined : secondsUntil(payload.exp * 1000),
  };
}

/**
 * Judges which user, if any, a request is signed in as in the project of this app.
 *
 * It is the one implementation behind the middleware of every server SDK, so they cannot drift
 * apart on who counts as signed in. It runs on the server and on the edge, and it never throws for
 * a bad token: a bad token is a signed-out request.
 *
 * - A bearer token is judged first, as a JWT. When it signs a user of this project in, that is the
 *   answer and the cookie is not judged. Otherwise the cookie speaks for itself.
 * - The session cookie is the project's own, else the server's. A session of this project that is
 *   found in the cookie of the server is copied to the cookie of the project.
 * - A session cookie that has the shape of a JWT signs its `sub` in when it verifies and its `aud`
 *   names the project. It never reaches the backend, which does not re-check JWT claims.
 * - Any other session cookie is checked by the backend, with {@link checkOpaqueSessionToken}, and
 *   signs its user in when the session is live in this project. With
 *   {@link ResolveSessionOptions.checkOpaqueSession} set to `false` it is not checked: the result
 *   hands it on unchecked and touches no cookie.
 * - Only a cookie that held a dead session is cleared: one that the backend refused, or a JWT that
 *   fails verification or names no user of this project. When the backend gives no verdict, the
 *   result says so, see {@link ResolvedSession.undecided}, and the cookie stays.
 * - Without a project, nothing signs in, a warning is logged once, and no cookie is touched.
 *
 * @param request - What the request carries: the bearer token, a cookie reader and the data that
 * decides whether a cookie is `Secure`.
 * @param options - The settings to judge by.
 * @returns The auth state, whether the backend was undecided, and the cookies that the response
 * must set.
 *
 * @example
 * ```ts
 * const resolved = await resolveSession(
 *   {
 *     bearer: null,
 *     cookie: (name) => cookies.get(name) ?? null,
 *     requestUrl: request.url,
 *   },
 *   {
 *     url: "https://auth.example.com",
 *     projectId: "296547382910273",
 *     allowedAlgorithms: ["RS256", "ES256"],
 *     clockSkewMs: 5000,
 *     audience: undefined,
 *     allowedTokenTypes: ["JWT", "at+JWT"],
 *     jwksTimeoutMs: undefined,
 *     opaqueTokenTimeoutMs: 5000,
 *   },
 * );
 * if (resolved.auth.isAuthenticated) {
 *   console.log(resolved.auth.session.userId);
 * }
 * ```
 */
export async function resolveSession(
  request: SessionRequest,
  options: ResolveSessionOptions,
): Promise<ResolvedSession> {
  const { url, projectId, opaqueTokenTimeoutMs } = options;
  if (!projectId) {
    warnMissingProject();
    return { auth: signedOut(), undecided: false, cookies: [] };
  }

  // A Bearer token and the cookie are separate credentials: one that is not
  // this app's leaves the cookie to be judged on its own.
  if (request.bearer !== null) {
    const bearer = await judgeJwt(request.bearer, projectId, options);
    if (bearer.auth.isAuthenticated) {
      return { auth: bearer.auth, undecided: false, cookies: [] };
    }
  }

  const secure = secureFor(request);
  const stored = storedSession(request.cookie, projectId, secure);
  if (!stored) {
    return { auth: signedOut(), undecided: false, cookies: [] };
  }
  // A session of this project in the server's cookie is copied to the
  // project's own once it signs a user in; one already there stays as it is.
  const moved = (maxAge: number | undefined): SessionCookie[] =>
    stored.name === serverSessionCookieName(secure)
      ? [copiedToProjectCookie(stored.token, projectId, maxAge, secure)]
      : [];
  const cleared = (): SessionCookie[] => [clearedCookie(stored.name, secure)];

  if (isJwtShaped(stored.token)) {
    const judged = await judgeJwt(stored.token, projectId, options);
    if (judged.auth.isAuthenticated) {
      return { auth: judged.auth, undecided: false, cookies: moved(judged.maxAge) };
    }
    return { auth: signedOut(), undecided: false, cookies: judged.dead ? cleared() : [] };
  }

  if (options.checkOpaqueSession === false) {
    return { auth: signedOut(), undecided: false, cookies: [], unchecked: stored.token };
  }

  const check = await checkOpaqueSessionToken(stored.token, url, opaqueTokenTimeoutMs, projectId);
  const userId = check.verdict === "live" ? check.session.userId : null;
  if (check.verdict === "live" && userId) {
    const { session } = check;
    return {
      auth: {
        isAuthenticated: true,
        session: {
          userId,
          identifier: session.identifier,
          identifierProperty: session.identifierProperty,
          display: session.display,
          token: stored.token,
        },
      },
      undecided: false,
      cookies: moved(session.expiresAt ? secondsUntil(Date.parse(session.expiresAt)) : undefined),
    };
  }
  // Only the backend's refusal makes the cookie dead: a live session that
  // signs no one in here may still complete its sign-in or belongs to another
  // app, and a check without a verdict refused nothing.
  return {
    auth: signedOut(),
    undecided: check.verdict === "undecided",
    cookies: check.verdict === "refused" ? cleared() : [],
  };
}
