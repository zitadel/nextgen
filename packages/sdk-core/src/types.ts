import type { ZitadelProject } from '@zitadel/api/config';
import type {
  CreateFlow201Step,
  CreateFlow201StepComplete,
  CreateFlowBodyPurpose,
} from '@zitadel/api/generated/model';

/** Re-exported so consumers can type the `purpose` prop without a deep import. */
export type { CreateFlowBodyPurpose } from '@zitadel/api/generated/model';

/**
 * Shared types for the Nextgen SDKs: the middleware layer (`sdk-next`,
 * `sdk-nuxt`) and the SPA widget events (`sdk-react`, `sdk-vue`, `sdk-solid`,
 * `sdk-svelte`, `sdk-qwik`). Each SDK re-exports them from its own public
 * surface so consumers don't need a direct `sdk-core` dependency.
 */

/** Payload of the `zitadel-flow-step` event. */
export interface ZitadelFlowStepDetail {
  readonly step: CreateFlow201Step;
}

/** Payload of the `zitadel-flow-input` event. */
export interface ZitadelFlowInputDetail {
  readonly name: string;
  readonly value: string;
}

/** Payload of the `zitadel-flow-complete` event. */
export interface ZitadelFlowCompleteDetail {
  readonly behavior: CreateFlow201StepComplete;
  readonly redirect_uri?: string;
  readonly handoff_token?: string;
  readonly handoff_token_expires_at?: string;
}

/** Payload of the `zitadel-flow-error` event. */
export interface ZitadelFlowErrorDetail {
  readonly message: string;
}

/** Payload of the `zitadel-signout` event. */
export interface ZitadelSignoutDetail {
  readonly name: string;
  readonly email: string;
}

/* ───────────────────────────  SPA widget contract  ───────────────────────
 * Single source of truth shared by every SPA SDK (react, vue, angular, solid,
 * svelte, qwik). The event maps below declare which widget events exist and
 * what each carries; the config/handler/props types and the runtime name lists
 * are all derived from them. Adding or removing an event here is the ONE edit
 * that ripples to every SDK — the compile-time assertions in this file, the
 * `@zitadel/components` emit-conformance test, and each SDK's contract-driven
 * forwarding test all fail until every wrapper is brought back into line.
 * ───────────────────────────────────────────────────────────────────────── */

/** Events emitted by `<zitadel-login>`, keyed to their detail payload. */
export interface ZitadelLoginEventMap {
  'zitadel-flow-step': ZitadelFlowStepDetail;
  'zitadel-flow-input': ZitadelFlowInputDetail;
  'zitadel-flow-complete': ZitadelFlowCompleteDetail;
  'zitadel-flow-error': ZitadelFlowErrorDetail;
}

/** Events emitted by `<zitadel-logout>`, keyed to their detail payload. */
export interface ZitadelLogoutEventMap {
  'zitadel-signout': ZitadelSignoutDetail;
}

/**
 * Maps each `<zitadel-login>` event to the callback prop the SDKs expose. The
 * `satisfies Record<keyof ZitadelLoginEventMap, …>` is the drift lock: every
 * event needs exactly one handler entry — a missing one, or an extra one left
 * behind for a removed event, fails `tsc`. Everything below derives from this.
 */
export const ZITADEL_LOGIN_EVENT_HANDLERS = {
  'zitadel-flow-step': 'onFlowStep',
  'zitadel-flow-input': 'onFlowInput',
  'zitadel-flow-complete': 'onFlowComplete',
  'zitadel-flow-error': 'onFlowError',
} as const satisfies Record<keyof ZitadelLoginEventMap, `on${string}`>;

/** Maps the `<zitadel-logout>` event to the callback prop the SDKs expose. */
export const ZITADEL_LOGOUT_EVENT_HANDLERS = {
  'zitadel-signout': 'onSignout',
} as const satisfies Record<keyof ZitadelLogoutEventMap, `on${string}`>;

/** Runtime list of `<zitadel-login>` event names (drives wiring + drift tests). */
export const ZITADEL_LOGIN_EVENTS = Object.keys(
  ZITADEL_LOGIN_EVENT_HANDLERS,
) as (keyof ZitadelLoginEventMap)[];

/** Runtime list of `<zitadel-logout>` event names. */
export const ZITADEL_LOGOUT_EVENTS = Object.keys(
  ZITADEL_LOGOUT_EVENT_HANDLERS,
) as (keyof ZitadelLogoutEventMap)[];

/** Configuration props shared by every `ZitadelLogin` wrapper. */
export interface ZitadelLoginConfig {
  /** The SDK handle from `configureZitadel(...)`. */
  readonly project?: ZitadelProject;
  /** Discrete project id, read when no {@link project} handle is supplied. */
  readonly projectId?: string;
  /** Reverse-proxy path prefix the widget calls. */
  readonly proxyPath?: string;
  /** Flow purpose. @default "login" */
  readonly purpose?: CreateFlowBodyPurpose;
  /** Where to navigate after a completed sign-in. */
  readonly postSignInUrl?: string;
}

/** Configuration props shared by every `ZitadelLogout` wrapper. */
export interface ZitadelLogoutConfig {
  /** The SDK handle from `configureZitadel(...)`. */
  readonly project?: ZitadelProject;
  /** Discrete project id, read when no {@link project} handle is supplied. */
  readonly projectId?: string;
  /** Reverse-proxy path prefix the widget calls. */
  readonly proxyPath?: string;
  /** Where to navigate after sign-out. */
  readonly postSignOutUrl?: string;
}

/**
 * Plain-callback handlers for the `<zitadel-login>` events, derived from
 * {@link ZitadelLoginEventMap} and {@link ZITADEL_LOGIN_EVENT_HANDLERS} so the
 * prop set can never drift from the events it forwards.
 */
export type ZitadelLoginHandlers = {
  readonly [E in keyof ZitadelLoginEventMap as (typeof ZITADEL_LOGIN_EVENT_HANDLERS)[E]]?: (
    detail: ZitadelLoginEventMap[E],
  ) => void;
};

/** Plain-callback handler for the `<zitadel-logout>` event (derived, as above). */
export type ZitadelLogoutHandlers = {
  readonly [E in keyof ZitadelLogoutEventMap as (typeof ZITADEL_LOGOUT_EVENT_HANDLERS)[E]]?: (
    detail: ZitadelLogoutEventMap[E],
  ) => void;
};

/** Full prop set for a `ZitadelLogin` wrapper (config + plain-callback handlers). */
export type ZitadelLoginProps = ZitadelLoginConfig & ZitadelLoginHandlers;

/** Full prop set for a `ZitadelLogout` wrapper (config + plain-callback handlers). */
export type ZitadelLogoutProps = ZitadelLogoutConfig & ZitadelLogoutHandlers;

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

/** Union of all possible auth states. */
export type AuthResult = AuthState | UnauthState;

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

  /**
   * Optional hook called when a `POST /sessions/exchange` response is
   * proxied back to the browser. Receives the upstream `Response` after
   * hop-by-hop stripping and cookie upgrading. Return a modified
   * `Response` to add custom headers, extra `Set-Cookie` values, or
   * transform the body.
   *
   * The callback runs on the server — it has access to the full response
   * including `Set-Cookie` headers that are `HttpOnly` and invisible to
   * client-side JavaScript. It fires **after** the upstream has processed
   * the exchange; it cannot prevent the exchange itself (return a 403
   * `Response` to block the browser from receiving it).
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
