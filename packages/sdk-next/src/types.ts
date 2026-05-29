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
   * Optional hook called when a `POST /sessions/exchange` response is
   * proxied back to the browser. Receives the upstream `Response` after
   * hop-by-hop stripping and cookie upgrading. Return a modified
   * `Response` to add custom headers, extra `Set-Cookie` values, or
   * transform the body.
   *
   * The callback runs on the edge/server — it has access to the full
   * response including `Set-Cookie` headers that are `HttpOnly` and
   * invisible to client-side JavaScript. It fires **after** the upstream
   * has processed the exchange; it cannot prevent the exchange itself
   * (return a 403 `Response` to block the browser from receiving it).
   *
   * **Capabilities:**
   *
   * - **Add or modify cookies** — append `Set-Cookie` headers for
   *   user-preferences, analytics IDs, or any server-side state.
   * - **Make additional fetch calls** — enrich the session by calling
   *   your own backend, a profile service, or any external API. The
   *   response body can be read with `response.json()` to extract
   *   session details like `user_id`.
   * - **Map or transform response properties** — reshape the JSON body
   *   before it reaches the browser (e.g. strip internal fields, add
   *   computed properties).
   * - **Logging and auditing** — clone the response, read its body for
   *   audit trails, and return the original unchanged.
   *
   * @example Add a cookie
   * ```ts
   * onExchangeResponse: async (response) => {
   *   const headers = new Headers(response.headers);
   *   headers.append("Set-Cookie", "theme=dark; Path=/; SameSite=Lax");
   *   return new Response(response.body, {
   *     status: response.status,
   *     headers,
   *   });
   * },
   * ```
   *
   * @example Fetch additional data and set a cookie from it
   * ```ts
   * onExchangeResponse: async (response) => {
   *   const body = await response.json();
   *   const profile = await fetch(
   *     `https://api.example.com/users/${body.session.user_id}`,
   *   );
   *   const { locale } = await profile.json();
   *   const headers = new Headers(response.headers);
   *   headers.append("Set-Cookie", `locale=${locale}; Path=/; SameSite=Lax`);
   *   return new Response(JSON.stringify(body), {
   *     status: response.status,
   *     headers,
   *   });
   * },
   * ```
   *
   * @example Log the exchange for auditing (pass-through)
   * ```ts
   * onExchangeResponse: async (response) => {
   *   const cloned = response.clone();
   *   const body = await cloned.json();
   *   await auditLog.record("session_exchange", body.session.session_id);
   *   return response;
   * },
   * ```
   *
   * @example Modify existing cookies (e.g. tighten the session cookie path)
   * ```ts
   * onExchangeResponse: async (response) => {
   *   const headers = new Headers();
   *   for (const [key, value] of response.headers.entries()) {
   *     if (key.toLowerCase() !== "set-cookie") headers.set(key, value);
   *   }
   *   for (const cookie of response.headers.getSetCookie()) {
   *     if (cookie.startsWith("__nextgen_session=")) {
   *       headers.append("set-cookie", cookie.replace("Path=/", "Path=/app"));
   *     } else {
   *       headers.append("set-cookie", cookie);
   *     }
   *   }
   *   return new Response(response.body, { status: response.status, headers });
   * },
   * ```
   */
  onExchangeResponse?: (response: Response) => Response | Promise<Response>;
};
