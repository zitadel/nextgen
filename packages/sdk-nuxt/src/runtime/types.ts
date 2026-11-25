/**
 * Re-exports the shared auth and middleware types from `@zitadel/sdk-core`.
 *
 * The types are defined once in `@zitadel/sdk-core` and shared by every server SDK, so the session
 * shapes an app reads are identical across frameworks. The client-safe shapes
 * ({@link ClientSession}, {@link ClientAuthState} and {@link ClientAuthResult}) leave the raw
 * token out on purpose: it must not be serialized into the Nuxt server-rendered payload, where
 * scripts on the page could read it. Use `getAuth` on the server when the raw token is needed.
 */
export type {
  NextgenSession,
  AuthState,
  UnauthState,
  AuthResult,
  NextgenMiddlewareOptions,
  ClientSession,
  ClientAuthState,
  ClientAuthResult,
} from "@zitadel/sdk-core/middleware";
