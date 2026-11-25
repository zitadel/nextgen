/**
 * Re-exports the shared auth and middleware types from `@zitadel/sdk-core`.
 *
 * The types are defined once in `@zitadel/sdk-core` and shared by every server SDK, so the session
 * shapes an app reads are identical across frameworks. The client-safe shapes
 * ({@link ZitadelClientSession}, {@link ZitadelClientAuthState} and {@link ZitadelClientAuthResult}) leave the raw
 * token out on purpose: it must not be serialized into the Nuxt server-rendered payload, where
 * scripts on the page could read it. Use `getAuth` on the server when the raw token is needed.
 */
export type {
  ZitadelAuthSession,
  ZitadelAuthState,
  ZitadelUnauthState,
  ZitadelAuthResult,
  ZitadelMiddlewareOptions,
  ZitadelClientSession,
  ZitadelClientAuthState,
  ZitadelClientAuthResult,
} from "@zitadel/sdk-core/middleware";
