/**
 * Shared constants and utility functions for the SDK middleware proxy layer.
 *
 * These are consumed by both `sdk-next` and `sdk-nuxt` to avoid duplicating
 * pure, framework-agnostic logic.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Headers that must never be forwarded to an upstream service.
 * These are connection-level headers that are meaningful only between
 * two directly connected peers and become invalid when proxied.
 */
export const HOP_BY_HOP: ReadonlySet<string> = new Set([
  "connection",
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
 * before the `*`. All other entries require an exact match.
 *
 * @param pathname - The URL pathname to test.
 * @param routes   - The list of route patterns to match against.
 * @returns `true` if at least one pattern matches.
 */
export function matchesRoutes(pathname: string, routes: readonly string[]): boolean {
  if (routes.length === 0) {
    return false;
  }
  return routes.some((pattern) => {
    if (pattern.endsWith("*")) {
      return pathname.startsWith(pattern.slice(0, -1));
    }
    return pathname === pattern;
  });
}

// ─── Response header filtering ───────────────────────────────────────────────

/**
 * Filters upstream response headers for proxying: strips hop-by-hop headers,
 * `set-cookie` (handled separately via `getSetCookie()`), and `location`
 * (prevents leaking internal upstream URLs).
 *
 * @param upstream - The upstream response headers.
 * @returns A new `Headers` object with filtered headers.
 */
export function filterResponseHeaders(upstream: Headers): Headers {
  const filtered = new Headers();
  upstream.forEach((value, key) => {
    if (
      !HOP_BY_HOP.has(key.toLowerCase()) &&
      key.toLowerCase() !== "set-cookie" &&
      key.toLowerCase() !== "location"
    ) {
      filtered.set(key, value);
    }
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
   * URL path prefix that is reverse-proxied to the auth backend.
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
