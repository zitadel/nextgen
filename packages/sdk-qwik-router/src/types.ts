/**
 * Re-exports shared SDK types from `@zitadel/sdk-core`.
 *
 * The middleware-layer types are defined once in sdk-core and shared by every
 * server SDK (`sdk-next`, `sdk-nuxt`, `sdk-sveltekit`, `sdk-tanstack-start`,
 * `sdk-solid-start`, `sdk-qwik-router`).
 */
export type {
  NextgenSession,
  AuthState,
  UnauthState,
  AuthResult,
  NextgenMiddlewareOptions,
  // Client-safe auth shapes (token absent), declared once in sdk-core.
  ClientSession,
  ClientAuthState,
  ClientAuthResult,
} from "@zitadel/sdk-core/middleware";
