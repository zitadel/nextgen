/**
 * Shared constants and utility functions for the SDK middleware proxy layer.
 *
 * These are consumed by every server SDK (`sdk-next`, `sdk-nuxt`,
 * `sdk-sveltekit`, `sdk-solid-start`, `sdk-qwik-city`, `sdk-tanstack-start`)
 * so the framework-agnostic logic and its failure semantics stay identical.
 */

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
  // which surfaced as an opaque "fetch failed" in the Qwik City proxy.
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
export const INTERNAL_HEADERS: ReadonlySet<string> = new Set([
  "x-nextgen-auth-token",
  "x-nextgen-auth-state",
]);

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
  if (routes.length === 0) {
    return false;
  }
  const path = withoutTrailingSlash(pathname);
  return routes.some((pattern) => {
    if (pattern.endsWith("*")) {
      return pathname.startsWith(pattern.slice(0, -1));
    }
    return path === withoutTrailingSlash(pattern);
  });
}

/**
 * Strips trailing slashes, keeping the root path `/` itself. A linear scan, not
 * `/\/+$/`: that regex backtracks quadratically on a path of many slashes, and
 * the pathname is attacker-controlled on every request.
 */
function withoutTrailingSlash(path: string): string {
  let end = path.length;
  while (end > 1 && path.charCodeAt(end - 1) === 0x2f) {
    end--;
  }
  return path.slice(0, end);
}

/**
 * The routes {@link assertLoginPath} checks a login path against, so the login
 * page is never one a signed-out visitor is redirected away from.
 */
export type LoginPathRoutes = {
  readonly protectedRoutes?: readonly string[];
  readonly ignoredRoutes?: readonly string[];
};

/**
 * Throws unless `loginPath` is a path on this app: it must start with a single
 * `/`. An absolute URL (`https://evil.com/phish`) or a protocol-relative one
 * (`//evil.com`) would turn the protected-route redirect into an open redirect.
 *
 * Given the middleware's routes, it also throws when `protectedRoutes` matches
 * the login page itself (and `ignoredRoutes` does not exempt it): a visitor
 * without a session would be redirected from the login page to the login page
 * forever.
 *
 * Every SDK calls this once, when its middleware is created, so a bad value
 * fails at startup instead of on every request.
 *
 * @param loginPath - The configured login path.
 * @param routes    - The middleware's protected and ignored routes.
 */
export function assertLoginPath(loginPath: string, routes: LoginPathRoutes = {}): void {
  if (!loginPath.startsWith("/") || loginPath.startsWith("//")) {
    throw new Error(
      `[nextgen] loginPath must be a relative path starting with a single "/". ` +
        `Received: "${loginPath}". Using an absolute or protocol-relative URL ` +
        `would allow open-redirect attacks.`,
    );
  }
  const pathname = loginPath.split(/[?#]/, 1)[0] ?? loginPath;
  if (
    matchesRoutes(pathname, routes.protectedRoutes ?? []) &&
    !matchesRoutes(pathname, routes.ignoredRoutes ?? [])
  ) {
    throw new Error(
      `[nextgen] loginPath "${loginPath}" is matched by protectedRoutes, so a visitor ` +
        `without a session would be redirected to the login page from the login page ` +
        `forever. Narrow protectedRoutes or add the login path to ignoredRoutes.`,
    );
  }
}

// ─── Proxy credentials ───────────────────────────────────────────────────────

/**
 * Whether a proxied call may carry the confidential project secret.
 *
 * ADR 036: the browser flow needs the secret only for the handoff exchange
 * (`POST /sessions/exchange`). Stamping it onto every proxied operation would
 * turn the app's public `/__nextgen/*` boundary into an open relay carrying
 * project-level authority for any anonymous caller.
 *
 * @param method   - The proxied request's HTTP method.
 * @param pathname - The path after the proxy prefix, e.g. `/sessions/exchange`.
 * @returns `true` only for the handoff exchange.
 */
export function requiresProjectSecret(method: string, pathname: string): boolean {
  return method.toUpperCase() === "POST" && pathname === "/sessions/exchange";
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

/**
 * Why a request is not signed in, when that is not simply "no session".
 *
 * - `unavailable`: the request carries a session the backend could not check
 *   (it is unreachable, slow or failing). The session may well be live and its
 *   cookie is kept, so an app guard should answer a retryable error (a `503`)
 *   instead of sending the user to the login page.
 */
export type UnauthReason = "unavailable";

/**
 * Auth state when the user is not signed in. `reason` is set only when the
 * session could not be checked ({@link UnauthReason}); it is absent for a
 * visitor who has no session, a dead one, or one that names no user yet.
 */
export type UnauthState = { isAuthenticated: false; session: null; reason?: UnauthReason };

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
   * A `next` query parameter is appended with the originally requested path.
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
   * Requests that do not complete within this window are aborted and answered
   * with a `504`; an upstream that cannot be reached at all is a `502`.
   * @default 5000
   */
  proxyTimeoutMs?: number;

  /**
   * Timeout in milliseconds for opaque (non-JWT) session token validation
   * via the backend's `GET /sessions/me` endpoint. Tokens the backend has not
   * answered within this window leave the request signed out for now but keep
   * their cookie — a slow backend is not a dead session — and a protected
   * route answers `503` instead of redirecting to the login page.
   * @default 5000
   */
  opaqueTokenTimeoutMs?: number;
};

// ─── Cookies ─────────────────────────────────────────────────────────────────

/**
 * Parses a `Cookie` request header into a name→value map, for runtimes that
 * hand the middleware a bare Web `Request` without a cookie API.
 *
 * @param header - The raw `Cookie` header, or `null` when absent.
 * @returns The cookies by name; a name sent twice keeps its last value.
 */
export function parseCookieHeader(header: string | null): Map<string, string> {
  const jar = new Map<string, string>();
  if (!header) return jar;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) jar.set(name, value);
  }
  return jar;
}

/**
 * A `Set-Cookie` value that clears `name` on the root path, where the backend
 * sets the `__nextgen*` cookies.
 *
 * @param name - The cookie to clear.
 */
export function clearCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0`;
}

// ─── Opaque session tokens ───────────────────────────────────────────────────

/**
 * What the backend reports for an opaque (non-JWT) session token.
 *
 * `userId` is `null` for an anonymous session: `CreateSession` sets the
 * session cookie before any user factor is verified, so an abandoned or
 * in-progress sign-in holds a live session that names no user. Such a session
 * is **not** signed in, but it is not dead either — its flow may still
 * complete — so callers keep its cookie instead of clearing it.
 */
export interface OpaqueSession {
  readonly userId: string | null;
  readonly identifier: string | null;
  readonly identifierProperty: string | null;
  readonly display: string | null;
}

/**
 * The outcome of asking the backend about an opaque session token.
 *
 * - `live`: the backend holds the session. Its `userId` is `null` when it is
 *   anonymous (see {@link OpaqueSession}).
 * - `dead`: the backend itself answered that the token names no session — a
 *   `401` carrying its `auth.unauthorized` error code (an invalid, expired or
 *   revoked token) or a `404` carrying `sess.not_found` (a session that is
 *   gone). Only this outcome justifies clearing the cookie.
 * - `unknown`: the backend could not say — a network error, a timeout, any
 *   other status, a `401`/`404` without the backend's error code (a gateway,
 *   WAF or wrong base path answers those too) or an unreadable body. The
 *   session may well be live, so callers keep the cookie and treat the request
 *   as not signed in for now (`reason: "unavailable"`); a protected route
 *   answers {@link sessionUnavailableResponse} instead of sending a signed-in
 *   user to the login page. Clearing the cookie here would sign every user out
 *   whenever the backend restarts.
 */
export type OpaqueSessionCheck =
  | { readonly status: "live"; readonly session: OpaqueSession }
  | { readonly status: "dead" }
  | { readonly status: "unknown" };

/**
 * How long, after a session check came back `unknown`, further checks against
 * the same backend answer `unknown` at once instead of asking it again. An
 * outage that hangs would otherwise cost every request from every signed-in
 * user the full `opaqueTokenTimeoutMs`, and send each of those requests to a
 * backend that is already struggling.
 */
export const SESSION_CHECK_BACKOFF_MS = 5_000;

/** Per backend URL: until when a session check answers `unknown` without asking. */
const sessionCheckBackoff = new Map<string, number>();

/**
 * Ends every session-check backoff ({@link SESSION_CHECK_BACKOFF_MS}), so the
 * next check asks the backend again. For tests, and for a process that knows
 * the backend is back.
 */
export function clearSessionCheckBackoff(): void {
  sessionCheckBackoff.clear();
}

/** The `code` of the backend's error envelope, or `undefined` when the body is not one. */
async function errorCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { code?: unknown } | null;
    return typeof body?.code === "string" ? body.code : undefined;
  } catch {
    return undefined;
  }
}

/** Why a check came back `unknown`, for the log line. */
function describeFailure(error: unknown, timeoutMs: number): string {
  if ((error as { name?: unknown } | null)?.name === "TimeoutError") {
    return `no answer within ${timeoutMs}ms`;
  }
  if (error instanceof SyntaxError) {
    return "an unreadable response body";
  }
  return `a network error (${error instanceof Error ? error.message : String(error)})`;
}

/**
 * Validates an opaque session token by asking the backend
 * (`GET {issuerUrl}/sessions/me`) whether the session is live.
 *
 * Identity fields are normalised: anything other than a non-empty string
 * (an empty `display`, a numeric `user_id`) reads as `null`, so a UI rendering
 * `display ?? identifier` never shows an empty name.
 *
 * An `unknown` outcome is logged once and starts a backoff of
 * {@link SESSION_CHECK_BACKOFF_MS} for `issuerUrl`: until it ends, checks
 * answer `unknown` at once, without asking the backend or logging again.
 *
 * @param token     - The opaque session token from the `__nextgen_session` cookie.
 * @param issuerUrl - Base URL of the auth backend.
 * @param timeoutMs - How long to wait for the backend before giving up.
 * @returns An {@link OpaqueSessionCheck}: `live` with the session, `dead` only
 *   when the backend answered `401 auth.unauthorized` or `404 sess.not_found`,
 *   else `unknown`.
 */
export async function validateOpaqueSessionToken(
  token: string,
  issuerUrl: string,
  timeoutMs: number,
): Promise<OpaqueSessionCheck> {
  const backoffUntil = sessionCheckBackoff.get(issuerUrl);
  if (backoffUntil !== undefined) {
    if (Date.now() < backoffUntil) {
      return { status: "unknown" };
    }
    sessionCheckBackoff.delete(issuerUrl);
  }
  const unknown = (why: string): OpaqueSessionCheck => {
    sessionCheckBackoff.set(issuerUrl, Date.now() + SESSION_CHECK_BACKOFF_MS);
    console.warn(
      `[nextgen] could not check the session at ${issuerUrl}/sessions/me: ${why}. ` +
        "Requests carrying a session are treated as signed out for now (the cookie is " +
        "kept, protected routes answer 503), and the backend is not asked again for " +
        `${SESSION_CHECK_BACKOFF_MS}ms. If this persists, check ZITADEL_URL or the url option.`,
    );
    return { status: "unknown" };
  };
  try {
    const res = await fetch(`${issuerUrl}/sessions/me`, {
      method: "GET",
      headers: { accept: "application/json", cookie: `__nextgen_session=${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401 || res.status === 404) {
      // A gateway, a WAF or a wrong base path answers 401/404 too; only the
      // backend's own error code says the session is gone.
      const code = await errorCode(res);
      if (
        (res.status === 401 && code === "auth.unauthorized") ||
        (res.status === 404 && code === "sess.not_found")
      ) {
        return { status: "dead" };
      }
      return unknown(`HTTP ${res.status} without the backend's error code`);
    }
    if (!res.ok) {
      return unknown(`HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      user_id?: unknown;
      user?: { identifier?: unknown; identifier_property?: unknown; display?: unknown };
    } | null;
    const text = (value: unknown): string | null =>
      typeof value === "string" && value !== "" ? value : null;
    return {
      status: "live",
      session: {
        userId: text(body?.user_id),
        identifier: text(body?.user?.identifier),
        identifierProperty: text(body?.user?.identifier_property),
        display: text(body?.user?.display),
      },
    };
  } catch (error) {
    // A network error, a timeout or an unreadable body: the backend did not
    // say the session is dead.
    return unknown(describeFailure(error, timeoutMs));
  }
}

// ─── Failure responses ───────────────────────────────────────────────────────

/**
 * The answer to a protected route whose session could not be checked because
 * the backend is unreachable, slow or failing ({@link OpaqueSessionCheck}
 * `unknown`). A `503` the browser can retry, carrying no `Set-Cookie`: the
 * session cookie survives the outage, and a reload signs the user straight
 * back in once the backend answers again. Redirecting to the login page
 * instead would show a signed-in user a sign-in form.
 */
export function sessionUnavailableResponse(): Response {
  return new Response("The sign-in service is unavailable. Try again shortly.", {
    status: 503,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "5",
    },
  });
}

/**
 * The answer to a proxied `/__nextgen/*` call the backend did not answer: `504`
 * when the upstream timed out (`proxyTimeoutMs`), `502` for any other failure
 * (connection refused, DNS, reset). The body uses the backend's error envelope
 * (`{ code, message }`), so the widgets read it like any other API error
 * instead of a framework's HTML error page.
 *
 * @param error - What the upstream `fetch` rejected with.
 */
export function proxyFailureResponse(error: unknown): Response {
  const timedOut = (error as { name?: unknown } | null)?.name === "TimeoutError";
  return Response.json(
    timedOut
      ? { code: "proxy.upstream_timeout", message: "The sign-in service did not answer in time." }
      : { code: "proxy.upstream_unreachable", message: "The sign-in service is unreachable." },
    { status: timedOut ? 504 : 502, headers: { "cache-control": "no-store" } },
  );
}
