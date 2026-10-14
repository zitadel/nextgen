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
  UnauthReason,
  AuthResult,
  NextgenMiddlewareOptions,
  // Client-safe auth shapes (token intentionally absent — the raw session token
  // must not be serialised into an SSR payload where client-side scripts could
  // read it; use getAuth server-side when it is needed). Defined in sdk-core so
  // every SDK hands the client the identical shape.
  ClientSession,
  ClientAuthState,
  ClientAuthResult,
} from "@zitadel/sdk-core/middleware";
