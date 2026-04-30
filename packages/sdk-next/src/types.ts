/**
 * The authenticated session for a signed-in user.
 */
export type NextgenSession = {
  /** The user's unique identifier (`sub` claim). */
  userId: string;
  /** The user's email address, or `null` if not present in the token. */
  email: string | null;
  /** The user's display name, or `null` if not present in the token. */
  name: string | null;
  /** The raw verified JWT. */
  token: string;
};

/** Auth state when the user is signed in. */
export type AuthState = { isAuthenticated: true; session: NextgenSession };

/** Auth state when the user is not signed in. */
export type UnauthState = { isAuthenticated: false; session: null };

/** Union of all possible auth states returned by {@link auth} and {@link useAuth}. */
export type AuthResult = AuthState | UnauthState;

/**
 * Options passed to {@link nextgenMiddleware}.
 */
export type NextgenMiddlewareOptions = {
  /**
   * Full URL of the Nextgen auth backend.
   * @default process.env.NEXTGEN_ISSUER_URL ?? "http://localhost:4000"
   */
  issuerUrl?: string;

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
   * Restrict accepted JWT `alg` header values. When set, any token whose
   * algorithm is not in this list is rejected before JWKS is fetched.
   * When omitted, all algorithms are accepted.
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
};
