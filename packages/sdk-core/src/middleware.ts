/**
 * Shared constants and utility functions for the SDK middleware proxy layer.
 *
 * These are consumed by every server SDK to avoid duplicating
 * framework-agnostic logic.
 */

import type { JwtPayload } from "./jwt.js";

import { API_PREFIX } from "@zitadel/api/runtime/base-url";
import { joinURL } from "ufo";

import { isJwtShaped, verifyJwt } from "./jwt.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Headers that must never be forwarded to an upstream service.
 * These are connection-level headers that are meaningful only between
 * two directly connected peers and become invalid when proxied.
 */
export const HOP_BY_HOP: ReadonlySet<string> = new Set([
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
 * SDK-internal headers that must never be forwarded to the upstream backend.
 * These headers carry session data between the middleware and server components;
 * forwarding them upstream would expose internal state and allow header injection.
 */
export const INTERNAL_HEADERS: ReadonlySet<string> = new Set(["x-nextgen-auth-token"]);

// ─── Route matching ──────────────────────────────────────────────────────────

/**
 * Returns `true` when `pathname` matches at least one entry in `routes`.
 *
 * An entry ending with `*` matches any path that starts with the prefix
 * before the `*`. All other entries match exactly, ignoring a trailing slash
 * on either side: `/profile` and `/profile/` name the same route, and several
 * frameworks (Qwik Router by default) serve the slashed form as canonical. An
 * exact compare would let `/profile/` past a `protectedRoutes: ["/profile"]`.
 *
 * @param pathname - The URL pathname to test.
 * @param routes   - The list of route patterns to match against.
 * @returns `true` if at least one pattern matches.
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
  const path = withoutTrailingSlash(pathname);

  return routes.some((route) => {
    if (route.endsWith("*")) {
      return pathname.startsWith(route.slice(0, -1));
    }
    return path === withoutTrailingSlash(route);
  });
}

// ─── Login redirect ──────────────────────────────────────────────────────────

/**
 * The query parameter that brings a signed-out request's path to the login
 * page, where `<zitadel-login>` returns after sign-in.
 */
const RETURN_PATH_PARAM = "next";

/**
 * Where a signed-out request for a protected route is sent: `loginPath`, with
 * the requested path and query string in `next`, so `<zitadel-login>` returns
 * to the page as it was asked for, filters and tabs included. The fragment
 * never reaches the server, so it cannot be carried.
 *
 * A `next` the request carries itself is left out, so a redirect never nests
 * an earlier one: should the login page be protected by mistake, each pass of
 * the redirect loop would otherwise wrap the last and grow the URL. The rest
 * of the query keeps the encoding it was sent with.
 *
 * Whatever query `loginPath` has of its own is kept, except a `next`, which
 * this replaces.
 *
 * @param loginPath  - The login page, a path starting with a single `/`.
 * @param requestUrl - The full URL of the signed-out request.
 * @returns The URL to redirect to, on the request's origin.
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

// ─── Proxy credentials ───────────────────────────────────────────────────────

/**
 * The operation a proxied path names: the path without the API prefix
 * (ADR 077), so `/api/v1/sessions/me` and `/sessions/me` name the same one.
 * Until 1.0.0 the server answers both spellings, and so every check here that
 * decides by path accepts both.
 */
function operationPath(path: string): string {
  if (path === API_PREFIX) {
    return "/";
  }
  return path.startsWith(`${API_PREFIX}/`) ? path.slice(API_PREFIX.length) : path;
}

/**
 * Whether a proxied call may carry the confidential project secret.
 *
 * ADR 036: the browser flow needs the secret only for the handoff exchange
 * (`POST /sessions/exchange`). Stamping it onto every proxied operation would
 * turn the app's public `/__nextgen/*` boundary into an open relay carrying
 * project-level authority for any anonymous caller.
 *
 * @param method   - The proxied request's HTTP method.
 * @param pathname - The path after the proxy prefix, e.g. `/sessions/exchange`
 *   or `/api/v1/sessions/exchange`.
 * @returns `true` only for the handoff exchange.
 */
export function requiresProjectSecret(method: string, pathname: string): boolean {
  return method.toUpperCase() === "POST" && operationPath(pathname) === "/sessions/exchange";
}

// ─── Response header filtering ───────────────────────────────────────────────

/**
 * An upstream `Location`, pointed back at this app.
 *
 * Only the path, query and fragment survive; whatever origin the upstream
 * named is discarded and the result is re-based onto the request's own URL.
 * That keeps both properties the blanket strip was protecting -- an internal
 * hostname can never reach the browser, and the redirect can only ever land on
 * this app -- without needing to know what this app's public origin is.
 *
 * Comparing origins instead would have required that knowledge, and there is
 * no reliable source for it: `X-Forwarded-Host` is attacker-settable on a
 * direct request, and the request's own host is wrong behind a proxy that
 * terminates TLS or rewrites it. Discarding the origin sidesteps the question
 * -- a redirect to another origin becomes the same path on this one rather
 * than being dropped, so a deployment behind such a proxy works instead of
 * landing on a blank page.
 *
 * Nothing legitimate on this path points off-origin anyway: an outbound
 * redirect to a provider travels as `step.redirect_url` in a JSON body and the
 * widget performs it, never as a proxied header.
 *
 * A relative reference resolves against the path it came from (RFC 3986 §5),
 * so `next?flow=x` answered to `/__nextgen/idp/google/callback` means
 * `/__nextgen/idp/google/next?flow=x`. An unparseable value is the one case with
 * nothing to forward.
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
 * Filters upstream response headers for proxying: strips hop-by-hop headers
 * and `set-cookie` (handled separately via `getSetCookie()`), and reduces
 * `location` to a redirect that can only land on this app.
 *
 * `location` was stripped outright until the identity-provider callback
 * needed it: the provider returns the browser to `/__nextgen/idp/{slug}/callback`,
 * and the engine answers `303` back to the page the sign-in started on. That
 * is a top-level navigation with no JavaScript in the loop, so a dropped
 * `Location` leaves the browser on an empty page. Outbound redirects to a
 * provider do not travel this way -- they arrive as `step.redirect_url` in a
 * JSON body and the widget navigates -- so nothing legitimate points off-origin.
 *
 * @param upstream - The upstream response headers.
 * @param selfUrl - The app's own request URL, which is both the origin a
 *   redirect must land on and the base a relative one resolves against.
 *   Omitting it keeps the old behaviour of dropping every redirect.
 * @returns A new `Headers` object with filtered headers.
 */
export function filterResponseHeaders(upstream: Headers, selfUrl?: string): Headers {
  const filtered = new Headers();
  upstream.forEach((value, key) => {
    const name = key.toLowerCase();
    if (HOP_BY_HOP.has(name) || name === "set-cookie") {
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

// ─── Session cookies ─────────────────────────────────────────────────────────

/** The cookie the server sets a session in and reads it from. */
export const SERVER_SESSION_COOKIE = "__nextgen_session";

/** Every app's own session cookie starts with this. */
const PROJECT_SESSION_COOKIE_PREFIX = `${SERVER_SESSION_COOKIE}_`;

/**
 * The cookie an app keeps its project's session in: the server's name with the
 * project id appended (ADR 073). A browser shares one cookie jar across every
 * port of a host, so under the server's name alone the Console of a local
 * server and every app on `localhost` would hold their sessions in one slot and
 * replace each other's.
 *
 * Every byte of the id outside `[A-Za-z0-9_-]` is percent-encoded, so any
 * configured id makes a valid cookie name. Ids the server mints need none.
 */
export function sessionCookieName(projectId: string): string {
  let name = PROJECT_SESSION_COOKIE_PREFIX;
  for (const byte of new TextEncoder().encode(projectId)) {
    const char = String.fromCharCode(byte);
    name += /[A-Za-z0-9_-]/.test(char)
      ? char
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return name;
}

/** Whether `name` is a session cookie: the server's, or any app's own. */
function isSessionCookie(name: string): boolean {
  return name === SERVER_SESSION_COOKIE || name.startsWith(PROJECT_SESSION_COOKIE_PREFIX);
}

/**
 * A session cookie a response sets. An empty `value` with `maxAge: 0` clears
 * it.
 */
export interface SessionCookie {
  readonly name: string;
  readonly value: string;
  /** Seconds the browser keeps it, or `undefined` for the browser session. */
  readonly maxAge: number | undefined;
  readonly secure: boolean;
}

/**
 * The `Set-Cookie` value for `cookie`, with the attributes the server gives its
 * own session cookie: `Path=/`, `HttpOnly`, `SameSite=Lax`.
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
 * The `Cache-Control` of a response that sets a session cookie, as the server
 * sends on its session answers: a shared cache must not hand the cookie, the
 * session token it carries or its clearing, to the next visitor.
 */
export const SESSION_COOKIE_CACHE_CONTROL = "private, no-store";

/** The browser's request as the app sees it, and as a proxy in front of it forwarded it. */
export interface BrowserRequest {
  /** The app's own request URL. */
  readonly requestUrl: string | URL;
  /** The request's `X-Forwarded-Proto`, or `null`. */
  readonly forwardedProto?: string | null;
  /** The request's `X-Forwarded-Host`, or `null`. */
  readonly forwardedHost?: string | null;
}

/** The first entry of a forwarded header a chain of proxies appended to, if any. */
function firstForwarded(value: string | null | undefined): string | undefined {
  const first = value?.split(",")[0]?.trim();
  return first ? first : undefined;
}

/**
 * Whether a session cookie this app sets needs `Secure`, by the rule the server
 * applies to its own (`cookieSecureFromContext`): always, except over plain
 * http to a loopback host, where Safari would drop a `Secure` cookie. The
 * scheme and host are what a proxy in front of the app forwarded (the first
 * `X-Forwarded-Proto` and `X-Forwarded-Host`), else the app's request URL's,
 * so an app behind a TLS proxy that talks to it over loopback keeps `Secure`.
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

/** Seconds from now until `epochMs`, at least one, or `undefined` when unknown. */
function secondsUntil(epochMs: number): number | undefined {
  return Number.isFinite(epochMs)
    ? Math.max(1, Math.floor((epochMs - Date.now()) / 1000))
    : undefined;
}

/** Clears the cookie `name`. */
function clearedCookie(name: string, secure: boolean): SessionCookie {
  return { name, value: "", maxAge: 0, secure };
}

/**
 * Copies a session of this project found in the server's cookie into the
 * project's own. The server's cookie keeps it: on a server without platform
 * bootstrap the Console signs in to the app's project, and clearing the cookie
 * would sign it out. The proxy retires the server's cookie when the app signs
 * a user in or out ({@link proxySessionCookies}), so it cannot sign its user
 * back in once the app's own cookie is gone.
 */
function copiedToProjectCookie(
  token: string,
  projectId: string,
  maxAge: number | undefined,
  secure: boolean,
): SessionCookie {
  return { name: sessionCookieName(projectId), value: token, maxAge, secure };
}

/** The pieces of a `Cookie` header, each with the name it carries. */
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

/** The value of the first cookie named `name`, or `null` when it is absent or empty. */
function cookieValue(pieces: { name: string; piece: string }[], name: string): string | null {
  const found = pieces.find((candidate) => candidate.name === name);
  const value = found ? found.piece.slice(found.piece.indexOf("=") + 1).trim() : "";
  return value === "" ? null : value;
}

/** The name a `Set-Cookie` value sets. */
function setCookieName(setCookie: string): string {
  const index = setCookie.indexOf("=");
  return index === -1 ? "" : setCookie.slice(0, index).trim();
}

/**
 * What a proxied request carries that decides its session cookies. The
 * request URL and the forwarded headers decide whether a cookie needs `Secure`.
 */
export interface ProxiedRequest extends BrowserRequest {
  readonly method: string;
  /** The path after the proxy prefix, e.g. `/sessions/me` or `/api/v1/sessions/me`. */
  readonly path: string;
  /** The query string, with its leading `?`, or `""`. */
  readonly search: string;
  /** The request's `Cookie` header, or `null`. */
  readonly cookie: string | null;
}

/** The server a proxy forwards to, for the calls it makes of its own. */
export interface ProxyUpstream {
  /** Base URL of the auth backend. */
  readonly url: string;
  /** How long to wait for an answer. */
  readonly timeoutMs: number;
}

/** What a proxied answer sends the browser. */
export interface ProxiedAnswer {
  readonly setCookies: string[];
  readonly body: ReadableStream<Uint8Array> | string | null;
}

/** A proxied call's session cookies, on the way up and on the way back. */
export interface ProxiedSessionCookies {
  /** The `Cookie` header to send upstream, or `null` to send none. */
  readonly upstreamCookie: string | null;
  /**
   * The upstream answer's way back to the browser: the `Set-Cookie` values and
   * the body to send. Send this body, never the upstream response's own, which
   * this may have read.
   */
  toBrowser(upstream: Response): Promise<ProxiedAnswer>;
}

/**
 * The session cookies of a call the app proxies to the server (ADR 073). The
 * server knows one session cookie, `__nextgen_session`; the app keeps its
 * project's session in {@link sessionCookieName}, so it neither replaces nor
 * reads the session of another app or of the Console on the same host.
 *
 * - On the way up, the app's own session cookie goes under the server's name,
 *   and every other session cookie stays behind. Other cookies pass unchanged.
 * - On the way back, a `Set-Cookie` of the server's session cookie, which sets
 *   or clears it, is renamed to the app's.
 * - A session kept under the server's name goes up to one call only, the
 *   session probe `GET /sessions/me?project_id=<project>`, which the server
 *   refuses for another project's session. When the answer signs a user of
 *   this project in, the session is copied to the app's cookie; the server's
 *   cookie keeps it, since the Console may share the project.
 * - When the app signs a user in (`POST /sessions/exchange`) or out
 *   (`DELETE /sessions/me`), a session still kept under the server's name is
 *   retired, or it would sign its user back in once the app's own cookie is
 *   gone: the server is asked about it in this project, and a session of this
 *   project is cleared (and on sign-out also ended), a dead one cleared, and
 *   one of another project, the Console's on `localhost`, left alone.
 * - Each of these calls is known by its path with or without the API prefix
 *   (`/api/v1`), which the server answers both ways until 1.0.0.
 * - Without a project the cookies pass as they are: nothing says which session
 *   is the app's.
 *
 * @param request   - The proxied request.
 * @param projectId - The project this app signs its users in to.
 * @param upstream  - The server the proxy forwards to, which it asks about a
 *   session kept under the server's name.
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

  const ownName = sessionCookieName(projectId);
  const pieces = cookiePieces(request.cookie);
  const own = cookieValue(pieces, ownName);
  // A session kept under the server's name, which goes up to the probe only.
  const shared = cookieValue(pieces, SERVER_SESSION_COOKIE);
  const method = request.method.toUpperCase();
  const operation = operationPath(request.path);
  const isProbe =
    method === "GET" &&
    operation === "/sessions/me" &&
    new URLSearchParams(request.search).get("project_id") === projectId;
  const signsIn = method === "POST" && operation === "/sessions/exchange";
  const signsOut = method === "DELETE" && operation === "/sessions/me";
  const probed = own === null && isProbe ? shared : null;
  const secure = secureFor(request);

  const sent = pieces.filter(({ name }) => !isSessionCookie(name)).map(({ piece }) => piece);
  const session = own ?? probed;
  if (session !== null) {
    sent.push(`${SERVER_SESSION_COOKIE}=${session}`);
  }

  return {
    upstreamCookie: sent.length > 0 ? sent.join("; ") : null,
    async toBrowser(answer) {
      const upstreamSetCookies = answer.headers.getSetCookie?.() ?? [];
      const setCookies = upstreamSetCookies.map((setCookie) =>
        setCookieName(setCookie) === SERVER_SESSION_COOKIE
          ? `${ownName}${setCookie.slice(setCookie.indexOf("="))}`
          : setCookie,
      );
      // A sign-in that set the app's session, or any sign-out: the session the
      // server's cookie still holds goes too, unless it is another project's.
      const setsSession = upstreamSetCookies.some(
        (setCookie) => setCookieName(setCookie) === SERVER_SESSION_COOKIE,
      );
      if (shared !== null && (signsOut || (signsIn && answer.ok && setsSession))) {
        if (await retiresSharedSession(shared, projectId, upstream, signsOut)) {
          setCookies.push(serializeSessionCookie(clearedCookie(SERVER_SESSION_COOKIE, secure)));
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
 * Whether the session kept under the server's name goes when the app signs a
 * user in or out: the server is asked about it in this project. A session of
 * this project goes, and on sign-out it is ended too, so that it cannot sign
 * its user back in; one the server no longer holds goes as well. One of another
 * project, the Console's on `localhost`, stays, and so does one the server gave
 * no verdict on, and a JWT, which the middleware judges itself.
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
      `${joinURL(upstream.url, "/sessions/me")}?project_id=${encodeURIComponent(projectId)}`,
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

/** The header the session's CSRF token travels in (ADR 053 §5). */
const CSRF_HEADER = "X-Zitadel-CSRF";

/**
 * Ends the session `cookie` carries, as `@zitadel/components` ends its own.
 * Sign-out is a write, so it carries the session's CSRF token (ADR 053 §5),
 * read first from `GET /sessions/me/csrf` in this project: a call without an
 * Origin passes the server's cross-site check, but not its token check.
 * Without a token it sends no revoke, which the server would refuse.
 */
async function revokeSession(
  cookie: string,
  projectId: string,
  upstream: ProxyUpstream,
): Promise<void> {
  try {
    const res = await fetch(
      `${joinURL(upstream.url, "/sessions/me/csrf")}?project_id=${encodeURIComponent(projectId)}`,
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
    await fetch(joinURL(upstream.url, "/sessions/me"), {
      method: "DELETE",
      headers: { cookie, [CSRF_HEADER]: answer.csrf_token },
      signal: AbortSignal.timeout(upstream.timeoutMs),
    });
  } catch {
    // No answer: the caller clears the cookie all the same.
  }
}

/** `text` as JSON, or `undefined` when it is not JSON. */
function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ─── Middleware types ──────────────────────────────────────────────────────────

/**
 * The authenticated session for a signed-in user. Identity follows the
 * user-ref vocabulary (ADR 058): render `display`, falling back to
 * `identifier`, then `userId`.
 */
export type NextgenSession = {
  /** The user's unique identifier (`sub` claim). */
  userId: string;
  /**
   * The user schema's designated identifier value (the login identifier,
   * e.g. an email address or username), or `null` when unresolved. On the
   * JWT path this carries the `email` claim.
   */
  identifier: string | null;
  /**
   * The schema property `identifier` came from (e.g. `"email"`), or `null`
   * when unknown — JWT-claim identities carry no property attribution.
   */
  identifierProperty: string | null;
  /** The user's display name rendering, or `null` when the schema designates none. */
  display: string | null;
  /** The raw verified JWT. */
  token: string;
};

/** Auth state when the user is signed in. */
export type AuthState = { isAuthenticated: true; session: NextgenSession };

/** Auth state when the user is not signed in. */
export type UnauthState = { isAuthenticated: false; session: null };

/** Union of all possible auth states. */
export type AuthResult = AuthState | UnauthState;

/**
 * The client-safe session exposed to app UI (headers, account menus).
 * Identical to {@link NextgenSession} but omits `token` — the raw session
 * token must never reach client-side JavaScript, whether through an SSR
 * payload or a client-side fetch result.
 */
export type ClientSession = {
  /** The user's unique identifier (`sub` claim). */
  userId: string;
  /** The designated identifier value (login identifier), or `null`. */
  identifier: string | null;
  /** The schema property the identifier came from, or `null`. */
  identifierProperty: string | null;
  /** The display name rendering, or `null`. */
  display: string | null;
};

/** Client-safe auth state when the user is signed in. */
export type ClientAuthState = { isAuthenticated: true; session: ClientSession };

/**
 * Union of all possible client-safe auth states. Returned by the client
 * session reads (`useAuth()` in sdk-nuxt, `getSession()` in sdk-next).
 * Token is intentionally absent — use the server-side helpers when the raw
 * token is needed.
 */
export type ClientAuthResult = ClientAuthState | UnauthState;

/**
 * Options passed to the SDK middleware factory (`nextgenMiddleware` in
 * sdk-next, `createNextgenMiddleware` in sdk-nuxt).
 */
export type NextgenMiddlewareOptions = {
  /**
   * Full URL of the Zitadel auth backend.
   * @default process.env.ZITADEL_URL ?? "http://localhost:8080"
   */
  url?: string;

  /**
   * The project this app signs its users in to. A session counts as signed in
   * only when it belongs to this project. A session of any other project on the
   * same server (a second app, or the Console, whose cookie the browser sends
   * to every port of a shared host) reads as signed out, and its cookie is left
   * alone.
   *
   * The app keeps its session in a cookie of its own,
   * `__nextgen_session_<projectId>` ({@link sessionCookieName}), so signing in
   * here neither replaces nor reads the session of another app or of the
   * Console on the same host (ADR 073).
   *
   * An opaque session token is checked by the backend
   * (`GET /sessions/me?project_id=…`) and against the project its answer names;
   * a JWT must name the project in its `aud` claim.
   *
   * Required: with no project, no session counts as signed in, and the proxy
   * passes the server's session cookie through unchanged. Each SDK falls back
   * to the `ZITADEL_PROJECT_ID` environment variable, then to its framework's
   * public project id variable, which `zitadel setup` writes to `.env.local`.
   */
  projectId?: string;

  /**
   * URL path prefix that is reverse-proxied to the auth backend.
   *
   * Sign-in with an external provider currently requires the default: the
   * provider returns to `/__nextgen/idp/{slug}/callback`, which is proxied only under
   * the default prefix.
   * @default "/__nextgen"
   */
  proxyPath?: string;

  /**
   * Pathnames that require a valid session. Requests to these routes without
   * a valid token are redirected to {@link loginPath}.
   * Entries ending with `*` match any sub-path (e.g. `"/admin*"`).
   *
   * When the backend cannot say whether a session cookie is live (it answers
   * `5xx`, does not answer in time, or cannot be reached), the route answers
   * `503 Service Unavailable` instead: the user may well be signed in, and the
   * login page would tell them they are not.
   * @default []
   */
  protectedRoutes?: string[];

  /**
   * Pathnames that are completely skipped by the middleware — no JWT
   * verification, no protection check, no header tunnelling.
   * Useful for webhooks, health-check endpoints, or any route where
   * running auth logic is undesirable.
   * Entries ending with `*` match any sub-path (e.g. `"/public*"`).
   * @default []
   */
  ignoredRoutes?: string[];

  /**
   * Pathname to redirect unauthenticated users to.
   * A `next` query parameter carries the requested path and query string,
   * where `<zitadel-login>` returns after sign-in.
   * @default "/login"
   */
  loginPath?: string;

  /**
   * Reserved for future use. Local PEM public key for offline JWT verification.
   */
  jwtKey?: string;

  /**
   * Restrict accepted JWT `alg` header values. Tokens whose algorithm is not
   * in this list are rejected before JWKS is fetched.
   * @default ["RS256", "ES256"]
   */
  allowedAlgorithms?: string[];

  /**
   * Clock skew tolerance in milliseconds applied to `exp`, `nbf`, and `iat`
   * claim validation.
   * @default 5000
   */
  clockSkewMs?: number;

  /**
   * Expected value(s) of the `aud` claim. When omitted, audience is not
   * validated. Pass a single string or an array when a token may carry
   * multiple audiences.
   */
  audience?: string | string[];

  /**
   * Accepted values for the JWT header `typ` claim (case-insensitive).
   * Tokens whose `typ` is not in this list are rejected.
   * Set to `[]` to disable token-type checking entirely.
   * @default ["JWT", "at+JWT"]
   */
  allowedTokenTypes?: string[];

  /**
   * Timeout in milliseconds for JWKS endpoint requests.
   * Requests that do not complete within this window are aborted and the
   * token is rejected, treating the request as unauthenticated.
   * @default 5000
   */
  jwksTimeoutMs?: number;

  /**
   * Timeout in milliseconds for upstream proxy requests.
   * Requests that do not complete within this window are aborted with a
   * network error. Defaults to 5 000 ms.
   * @default 5000
   */
  proxyTimeoutMs?: number;

  /**
   * Timeout in milliseconds for opaque (non-JWT) session token validation
   * via the backend's `GET /sessions/me` endpoint. A token the backend does
   * not answer for within this window is not refused: the request counts as
   * signed out, its session cookie is kept, and a protected route answers
   * `503` (see {@link protectedRoutes}).
   * @default 5000
   */
  opaqueTokenTimeoutMs?: number;
};

// ─── Opaque session tokens ───────────────────────────────────────────────────

/**
 * What the backend reports for an opaque (non-JWT) session token.
 *
 * `userId` is `null` when the session names no user of this app's project.
 * That is an anonymous session — `CreateSession` sets the session cookie
 * before any user factor is verified, so an abandoned or in-progress sign-in
 * holds a live session that names no user — or a live session of another
 * project. Such a session is **not** signed in, but it is not dead either, so
 * callers keep its cookie instead of clearing it: an anonymous sign-in may
 * still complete, and the other project's session belongs to the app that
 * signed it in.
 */
export interface OpaqueSession {
  readonly userId: string | null;
  readonly identifier: string | null;
  readonly identifierProperty: string | null;
  readonly display: string | null;
  /** When the session expires, as the backend reports it, or `null`. */
  readonly expiresAt: string | null;
}

/**
 * The error code the backend answers a session read with when the session
 * belongs to another project than the one the read names.
 */
export const SESSION_PROJECT_MISMATCH = "sess.project_mismatch";

/** A live session that names no user of this app's project. */
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
 * What a `GET /sessions/me` answer says about this app's project. A session of
 * another project names no user here: a backend that predates `project_id`
 * answers for any project, so the project the answer names is checked too.
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
 * The backend's verdict on an opaque session token, from
 * {@link checkOpaqueSessionToken}.
 *
 * - `live`: the backend holds a live session for the token. Its `userId` is
 *   `null` when the session names no user of this app's project: an anonymous
 *   one, or one of another project (see {@link OpaqueSession}).
 * - `refused`: the backend judged the token and refused it (`401`), or found
 *   the session it names gone (`404` with the `sess.not_found` code). Only
 *   this verdict makes the cookie dead.
 * - `undecided`: the backend gave no verdict: a `5xx` or any other answer, no
 *   answer in time, a network error, or a body that cannot be read. The
 *   backend answers `500`, never `401`, when it cannot decide (its token or
 *   key store failed), so that an outage does not sign its users out. The
 *   request counts as signed out, but the cookie is kept.
 */
export type OpaqueSessionCheck =
  | { readonly verdict: "live"; readonly session: OpaqueSession }
  | { readonly verdict: "refused" }
  | { readonly verdict: "undecided" };

/** The code the backend answers `GET /sessions/me` with when the session is gone. */
const SESSION_NOT_FOUND = "sess.not_found";

/**
 * Asks the backend (`GET {issuerUrl}/sessions/me?project_id={projectId}`)
 * whether an opaque session token names a live session in this app's project,
 * telling a refusal apart from no verdict.
 *
 * A live session of another project comes back with no user, like an
 * anonymous one: it signs no one in here, and its cookie is not dead. The
 * backend refuses such a session itself (`403 sess.project_mismatch`); the
 * project its answer names is checked as well, because a backend that predates
 * the parameter answers for any project.
 *
 * A `404` is a refusal only with the `sess.not_found` code. Without it, the
 * answer came from something in front of the backend (a proxy, a `url` with
 * the wrong path), which judged nothing.
 *
 * When there is no verdict, it logs why: the request it was asked for then
 * renders signed out, or answers `503` on a protected route, and nothing else
 * would say what went wrong.
 *
 * @param token     - The opaque session token from the app's session cookie.
 * @param issuerUrl - Base URL of the auth backend.
 * @param timeoutMs - How long to wait for the backend before giving up.
 * @param projectId - The project this app signs its users in to. Without one,
 *   no session can be shown to belong here: the backend is not asked, and the
 *   session reads as live with no user, so its cookie is kept.
 * @returns The backend's {@link OpaqueSessionCheck | verdict}.
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
  const endpoint = joinURL(issuerUrl, "/sessions/me");
  try {
    const res = await fetch(`${endpoint}?project_id=${encodeURIComponent(projectId)}`, {
      method: "GET",
      headers: { cookie: `${SERVER_SESSION_COOKIE}=${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401) {
      return { verdict: "refused" };
    }
    if (res.status === 404 && (await errorCode(res)) === SESSION_NOT_FOUND) {
      return { verdict: "refused" };
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
 * The opaque session tokens the backend placed in another project, so that a
 * request signed out here does not ask again about the session another app,
 * or on `localhost` the Console, keeps under the server's cookie: a session
 * never changes its project. Each is known for a while, and only so many.
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

/** The memo key of a token in a project: a hash, so that the memo holds no session token. */
async function otherProjectKey(token: string, projectId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `${projectId}:${hex}`;
}

/**
 * Forgets which session tokens the backend placed in another project
 * ({@link checkOpaqueSessionToken} remembers them for a while). For tests that
 * answer for the same token differently.
 */
export function clearSessionCheckCache(): void {
  otherProjectSessions.clear();
}

/**
 * Validates an opaque session token by asking the backend
 * (`GET {issuerUrl}/sessions/me?project_id={projectId}`) whether the session is
 * live in this app's project.
 *
 * `null` folds a refusal and no verdict together, so it says whether the
 * request is signed in, not whether the cookie is dead: clearing the cookie on
 * `null` signs users out whenever the backend fails. To decide that, use
 * {@link checkOpaqueSessionToken}.
 *
 * @param token     - The opaque session token from the app's session cookie.
 * @param issuerUrl - Base URL of the auth backend.
 * @param timeoutMs - How long to wait for the backend before giving up.
 * @param projectId - The project this app signs its users in to.
 * @returns The live session — with a `null` `userId` when it names no user of
 *   this project — or `null` when the backend did not confirm one: it refused
 *   the token, or gave no verdict.
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

/** The `code` of an error envelope, or `undefined` when the body is not one. */
async function errorCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { code?: unknown };
    return typeof body.code === "string" ? body.code : undefined;
  } catch {
    return undefined;
  }
}

/** Why a session check failed, for the log. */
function failureCause(err: unknown, timeoutMs: number): string {
  if ((err as { name?: unknown } | null)?.name === "TimeoutError") {
    return `no answer within ${timeoutMs} ms`;
  }
  // A failed fetch says only "fetch failed"; what failed is in its cause.
  const cause = (err as { cause?: unknown } | null)?.cause;
  return cause instanceof Error ? `${String(err)}: ${cause.message}` : String(err);
}

/** Logs why the backend gave no verdict on a session cookie, and returns that. */
function undecided(endpoint: string, cause: string): OpaqueSessionCheck {
  console.warn(
    `[nextgen] Could not check the session cookie against ${endpoint} (${cause}). ` +
      "That is not a refusal: the request counts as signed out, and the cookie is kept.",
  );
  return { verdict: "undecided" };
}

/**
 * Whether a verified JWT names `projectId` in its `aud` claim, the one place a
 * self-contained token can say which project it was issued for.
 */
export function jwtNamesProject(payload: JwtPayload, projectId: string): boolean {
  const audience = payload.aud === undefined ? [] : [payload.aud].flat();
  return projectId !== "" && audience.includes(projectId);
}

// ─── Session resolution ──────────────────────────────────────────────────────

/**
 * What a request carries that decides its session. The request URL and the
 * forwarded headers decide whether a cookie needs `Secure`.
 */
export interface SessionRequest extends BrowserRequest {
  /**
   * The `Authorization: Bearer` token, or `null`. It takes precedence: when it
   * signs a user of this project in, the cookie is not consulted.
   */
  readonly bearer: string | null;
  /** Reads one of the request's cookies by name. */
  readonly cookie: (name: string) => string | null | undefined;
}

/** The settings {@link resolveSession} judges a request's session by. */
export interface ResolveSessionOptions {
  readonly url: string;
  /** The project this app signs its users in to; see {@link NextgenMiddlewareOptions.projectId}. */
  readonly projectId: string | undefined;
  readonly allowedAlgorithms: readonly string[] | undefined;
  readonly clockSkewMs: number;
  readonly audience: string | readonly string[] | undefined;
  readonly allowedTokenTypes: readonly string[];
  readonly jwksTimeoutMs: number | undefined;
  readonly opaqueTokenTimeoutMs: number;
  /**
   * Whether an opaque session cookie is checked with the backend, a call to
   * the server on every request. `false` leaves it to a render layer that
   * checks the session itself, as sdk-next's `auth()` does: the result hands
   * the token on as {@link ResolvedSession.unchecked}. A JWT is judged either
   * way, without a call.
   * @default true
   */
  readonly checkOpaqueSession?: boolean;
}

/** A request's session, as {@link resolveSession} judged it. */
export interface ResolvedSession {
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

function signedOut(): UnauthState {
  return { isAuthenticated: false, session: null };
}

let warnedMissingProject = false;

/** Says once per process why no session counts: no project is configured. */
function warnMissingProject(): void {
  if (warnedMissingProject) {
    return;
  }
  warnedMissingProject = true;
  console.error(
    "[nextgen] No project id is configured, so no session counts as signed in. " +
      "Set ZITADEL_PROJECT_ID (or the `projectId` option) to the project this app signs its users in to.",
  );
}

/**
 * The cookie a request's session is read from: the project's own
 * ({@link sessionCookieName}), else the server's `__nextgen_session`, where
 * this app kept its sessions before ADR 073 and where, on `localhost`, the
 * Console keeps its own.
 */
function storedSession(
  cookie: SessionRequest["cookie"],
  projectId: string,
): { readonly name: string; readonly token: string } | null {
  for (const name of [sessionCookieName(projectId), SERVER_SESSION_COOKIE]) {
    const token = cookie(name);
    if (token) {
      return { name, token };
    }
  }
  return null;
}

/**
 * What {@link judgeJwt} makes of a JWT: who it signs in, whether a cookie
 * holding it is dead, and how long it lives.
 */
interface JwtVerdict {
  readonly auth: AuthResult;
  /** Whether a cookie holding the JWT is dead, so the browser can drop it. */
  readonly dead: boolean;
  /** Seconds until a JWT that signs its user in expires, if it says. */
  readonly maxAge: number | undefined;
}

/**
 * Judges a JWT. It signs its `sub` in when it verifies and its `aud` names
 * this project. Held in a cookie, it is dead when it fails verification or
 * names no user of this project; a verified JWT of another project is live
 * there, so its cookie stays.
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
 * Judges which user, if any, a request is signed in as in this app's project.
 * The one implementation behind every server SDK's middleware, so they cannot
 * drift on who counts as signed in.
 *
 * - A Bearer token is judged first, as a JWT. When it signs a user of this
 *   project in, that is the answer and the cookie is not judged; otherwise the
 *   cookie speaks for itself.
 * - The session cookie is the project's own, else the server's. A session of
 *   this project found in the server's cookie is copied to the project's own.
 * - A JWT-shaped session cookie signs its `sub` in when it verifies and its
 *   `aud` names the project. It never reaches the backend, which does not
 *   re-check JWT claims.
 * - Any other session cookie is checked by the backend
 *   ({@link checkOpaqueSessionToken}) and signs its user in when the session
 *   is live in this project. With `checkOpaqueSession: false` it is not: the
 *   result hands it on unchecked, and touches no cookie.
 * - Only a cookie that held a dead session is cleared: one the backend refused,
 *   or a JWT that fails verification or names no user of this project. When
 *   the backend gives no verdict, the result says so
 *   ({@link ResolvedSession.undecided}) and the cookie stays.
 * - Without a project nothing signs in, and no cookie is touched.
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

  const stored = storedSession(request.cookie, projectId);
  if (!stored) {
    return { auth: signedOut(), undecided: false, cookies: [] };
  }
  const secure = secureFor(request);
  // A session of this project in the server's cookie is copied to the
  // project's own once it signs a user in; one already there stays as it is.
  const moved = (maxAge: number | undefined): SessionCookie[] =>
    stored.name === SERVER_SESSION_COOKIE
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
