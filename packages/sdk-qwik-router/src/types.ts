/**
 * Re-exports the shared middleware types from `@zitadel/sdk-core`.
 *
 * The middleware-layer types are defined once in `@zitadel/sdk-core` and shared by every server
 * SDK (`sdk-next`, `sdk-nuxt`, `sdk-sveltekit`, `sdk-tanstack-start`, `sdk-solid-start` and
 * `sdk-qwik-router`), so an auth result has the same shape in each of them. Their documentation
 * lives in core. The client-safe shapes omit the session token, so they are the ones to pass to
 * the browser.
 */
export type {
  ZitadelAuthSession,
  AuthState,
  UnauthState,
  AuthResult,
  ZitadelMiddlewareOptions,
  // Client-safe auth shapes (token absent), declared once in sdk-core.
  ClientSession,
  ClientAuthState,
  ClientAuthResult,
} from "@zitadel/sdk-core/middleware";
