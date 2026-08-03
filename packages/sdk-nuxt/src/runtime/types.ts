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
  // Client-safe auth shapes (token intentionally absent — it must not be
  // serialised into the Nuxt SSR payload where third-party scripts can read
  // it; use getAuth server-side when the raw JWT is needed). Defined in
  // sdk-core so sdk-next's getSession() returns the identical shape.
  ClientSession,
  ClientAuthState,
  ClientAuthResult,
} from "@zitadel/sdk-core/middleware";
