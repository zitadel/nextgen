/**
 * Re-exports shared SDK types from `@zitadel/sdk-core`.
 *
 * These types are defined once in sdk-core and shared by both sdk-next
 * and sdk-nuxt.
 */
export type {
  NextgenSession,
  AuthState,
  UnauthState,
  AuthResult,
  NextgenMiddlewareOptions,
} from "@zitadel/sdk-core/middleware";

import type { UnauthState } from "@zitadel/sdk-core/middleware";

// ─── Nuxt-specific client-safe types ─────────────────────────────────────────

/**
 * The client-safe session exposed to Vue components via {@link useAuth}.
 * Identical to {@link NextgenSession} but omits `token` — the raw JWT must
 * not be serialised into the Nuxt SSR payload where third-party scripts can
 * read it.
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
 * Union of all possible auth states returned by {@link useAuth}.
 * Token is intentionally absent — use {@link getAuth} server-side when the
 * raw JWT is needed.
 */
export type ClientAuthResult = ClientAuthState | UnauthState;
