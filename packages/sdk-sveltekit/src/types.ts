/**
 * Re-exports shared SDK types from `@zitadel/sdk-core`.
 *
 * The middleware-layer types are defined once in sdk-core and shared by every
 * server SDK (`sdk-next`, `sdk-nuxt`, `sdk-sveltekit`, …).
 */
export type {
  NextgenSession,
  AuthState,
  UnauthState,
  AuthResult,
  NextgenMiddlewareOptions,
} from "@zitadel/sdk-core/middleware";

import type { UnauthState } from "@zitadel/sdk-core/middleware";

// ─── SvelteKit-specific client-safe types ────────────────────────────────────

/**
 * The client-safe session a load function may forward to the browser via the
 * page `data`. Identical to {@link NextgenSession} but omits `token` — the raw
 * JWT must not be serialised into the SSR payload where client-side scripts
 * could read it.
 */
export type ClientSession = {
  /** The user's unique identifier (`sub` claim). */
  userId: string;
  /** The user's email address, or `null` if not present in the token. */
  email: string | null;
  /** The user's display name, or `null` if not present in the token. */
  name: string | null;
};

/** Client-safe auth state when the user is signed in. */
export type ClientAuthState = { isAuthenticated: true; session: ClientSession };

/**
 * Union of all possible client-safe auth states. Token is intentionally absent
 * — use {@link getAuth} server-side when the raw JWT is needed.
 */
export type ClientAuthResult = ClientAuthState | UnauthState;
