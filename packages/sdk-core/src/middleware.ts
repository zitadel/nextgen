/**
 * Shared constants and utility functions for the SDK middleware proxy layer.
 *
 * These are consumed by every server SDK to avoid duplicating
 * framework-agnostic logic.
 */

import type { JwtPayload } from "./jwt.js";

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
   * An opaque session token is checked by the backend
   * (`GET /sessions/me?project_id=…`) and against the project its answer names;
   * a JWT must name the project in its `aud` claim.
   *
   * Required: with no project, no session counts as signed in. Each SDK falls
   * back to the `ZITADEL_PROJECT_ID` environment variable, then to its
   * framework's public project id variable, which `zitadel setup` writes to
   * `.env.local`.
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
   * Requests that do not complete within this window are aborted with a
   * network error. Defaults to 5 000 ms.
   * @default 5000
   */
  proxyTimeoutMs?: number;

  /**
   * Timeout in milliseconds for opaque (non-JWT) session token validation
   * via the backend's `GET /sessions/me` endpoint. Tokens that cannot be
   * validated within this window are treated as invalid.
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
}

/**
 * The error code the backend answers a session read with when the session
 * belongs to another project than the one the read names.
 */
export const SESSION_PROJECT_MISMATCH = "sess.project_mismatch";

/** A live session that names no user of this app's project. */
function noUser(): OpaqueSession {
  return { userId: null, identifier: null, identifierProperty: null, display: null };
}

/**
 * What the backend answers about an opaque session token:
 *
 * - `live`: it holds a live session for the token. `session.userId` is `null`
 *   when the session names no user of this app's project (an anonymous
 *   session, or a session of another project), so it signs no one in here.
 * - `dead`: it holds no live session for the token (`401` or `404`), so a
 *   cookie carrying the token can go.
 * - `unknown`: there is no verdict: a timeout, a network error, a `5xx` or any
 *   other answer, or an unreadable body. The session may well be live, so a
 *   cookie carrying it stays. `status` is the answer's HTTP status, or `null`
 *   when there was no usable answer.
 */
export type OpaqueSessionCheck =
  | { readonly state: "live"; readonly session: OpaqueSession }
  | { readonly state: "dead" }
  | { readonly state: "unknown"; readonly status: number | null };

/**
 * Asks the backend (`GET {issuerUrl}/sessions/me?project_id={projectId}`)
 * whether an opaque session token names a live session of this app's project.
 *
 * A live session of another project comes back with no user, like an
 * anonymous one: it signs no one in here, and its cookie is not dead. The
 * backend refuses such a session itself (`403 sess.project_mismatch`); the
 * project its answer names is checked as well, because a backend that predates
 * the parameter answers for any project.
 *
 * Only a `401` or a `404` is a dead session. The server answers `500`, not
 * `401`, when it cannot judge a token, so an outage never reads as a sign-out.
 *
 * @param token     - The opaque session token from the `__nextgen_session` cookie.
 * @param issuerUrl - Base URL of the auth backend.
 * @param timeoutMs - How long to wait for the backend before giving up.
 * @param projectId - The project this app signs its users in to. Without one,
 *   no session can be shown to belong here: the answer is a live session that
 *   names no user, and the backend is not asked.
 */
export async function checkOpaqueSessionToken(
  token: string,
  issuerUrl: string,
  timeoutMs: number,
  projectId: string,
): Promise<OpaqueSessionCheck> {
  if (!projectId) {
    return { state: "live", session: noUser() };
  }
  let res: Response;
  try {
    res = await fetch(`${issuerUrl}/sessions/me?project_id=${encodeURIComponent(projectId)}`, {
      method: "GET",
      headers: { cookie: `__nextgen_session=${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { state: "unknown", status: null };
  }
  if (res.status === 401 || res.status === 404) {
    return { state: "dead" };
  }
  if (res.status === 403 && (await errorCode(res)) === SESSION_PROJECT_MISMATCH) {
    return { state: "live", session: noUser() };
  }
  if (!res.ok) {
    return { state: "unknown", status: res.status };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { state: "unknown", status: null };
  }
  return { state: "live", session: sessionInProject(body, projectId) };
}

/**
 * Validates an opaque session token: {@link checkOpaqueSessionToken}, reduced
 * to the live session (with a `null` `userId` when it names no user of this
 * project) or `null` when the backend confirmed no live session, because the
 * session is dead or because there was no verdict.
 *
 * @param token     - The opaque session token from the `__nextgen_session` cookie.
 * @param issuerUrl - Base URL of the auth backend.
 * @param timeoutMs - How long to wait for the backend before giving up.
 * @param projectId - The project this app signs its users in to.
 */
export async function validateOpaqueSessionToken(
  token: string,
  issuerUrl: string,
  timeoutMs: number,
  projectId: string,
): Promise<OpaqueSession | null> {
  const check = await checkOpaqueSessionToken(token, issuerUrl, timeoutMs, projectId);
  return check.state === "live" ? check.session : null;
}

/**
 * What a `GET /sessions/me` answer says about this app's project: a session of
 * another project names no user here.
 */
function sessionInProject(body: unknown, projectId: string): OpaqueSession {
  const answer = (typeof body === "object" && body !== null ? body : {}) as {
    project_id?: unknown;
    user_id?: unknown;
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
  };
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

/**
 * Whether a verified JWT names `projectId` in its `aud` claim, the one place a
 * self-contained token can say which project it was issued for.
 */
export function jwtNamesProject(payload: JwtPayload, projectId: string): boolean {
  const audience = payload.aud === undefined ? [] : [payload.aud].flat();
  return projectId !== "" && audience.includes(projectId);
}

// ─── Session resolution ──────────────────────────────────────────────────────

/** The session tokens a request carries. */
export interface SessionTokens {
  /**
   * The `Authorization: Bearer` token, or `null`. It takes precedence: when it
   * signs a user of this project in, the cookie is not consulted.
   */
  readonly bearer: string | null;
  /** The `__nextgen_session` cookie, or `null`. */
  readonly cookie: string | null;
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
}

/** A request's session, as {@link resolveSession} judged it. */
export interface ResolvedSession {
  readonly auth: AuthResult;
  /**
   * Whether the response should clear the request's `__nextgen*` cookies so
   * the browser stops sending a dead session. Only the session cookie's own
   * verdict decides. It is dead when the backend answered that its session is
   * gone, or when it is a JWT that fails verification or names no user of this
   * project. It stays when its session is live (signed in, anonymous, or
   * another project's), when the backend gave no verdict, and when a Bearer
   * token signed the request in and the cookie was never judged.
   */
  readonly clearCookies: boolean;
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
 * Judges a JWT. It signs its `sub` in when it verifies and its `aud` names
 * this project. Held in a cookie, it is dead when it fails verification or
 * names no user of this project; a verified JWT of another project is live
 * there, so its cookie stays.
 */
async function judgeJwt(
  token: string,
  projectId: string,
  options: ResolveSessionOptions,
): Promise<ResolvedSession> {
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
    return { auth: signedOut(), clearCookies: true };
  }
  const namesProject = jwtNamesProject(payload, projectId);
  if (!payload.sub || !namesProject) {
    return { auth: signedOut(), clearCookies: namesProject };
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
    clearCookies: false,
  };
}

/**
 * Judges which user, if any, a request is signed in as in this app's project.
 * The one implementation behind every server SDK's middleware, so they cannot
 * drift on who counts as signed in.
 *
 * - A Bearer token is judged first, as a JWT. When it signs a user of this
 *   project in, that is the answer; otherwise the cookie speaks for itself.
 * - A JWT-shaped session cookie signs its `sub` in when it verifies and its
 *   `aud` names the project. It never reaches the backend, which does not
 *   re-check JWT claims.
 * - Any other session cookie is checked by the backend
 *   ({@link checkOpaqueSessionToken}) and signs its user in when the session is
 *   live in this project.
 * - Only a cookie judged dead is cleared; see {@link ResolvedSession.clearCookies}.
 * - Without a project nothing signs in, and no cookie is cleared.
 */
export async function resolveSession(
  tokens: SessionTokens,
  options: ResolveSessionOptions,
): Promise<ResolvedSession> {
  const { url, projectId, opaqueTokenTimeoutMs } = options;
  if (!projectId) {
    warnMissingProject();
    return { auth: signedOut(), clearCookies: false };
  }

  if (tokens.bearer !== null) {
    const bearer = await judgeJwt(tokens.bearer, projectId, options);
    if (bearer.auth.isAuthenticated) {
      return { auth: bearer.auth, clearCookies: false };
    }
  }

  const cookie = tokens.cookie;
  if (cookie === null) {
    return { auth: signedOut(), clearCookies: false };
  }
  if (isJwtShaped(cookie)) {
    return judgeJwt(cookie, projectId, options);
  }

  const check = await checkOpaqueSessionToken(cookie, url, opaqueTokenTimeoutMs, projectId);
  if (check.state === "live" && check.session.userId) {
    return {
      auth: {
        isAuthenticated: true,
        session: {
          userId: check.session.userId,
          identifier: check.session.identifier,
          identifierProperty: check.session.identifierProperty,
          display: check.session.display,
          token: cookie,
        },
      },
      clearCookies: false,
    };
  }
  return { auth: signedOut(), clearCookies: check.state === "dead" };
}
