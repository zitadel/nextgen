/**
 * Shared auth and middleware types of `@zitadel/sdk-next`, re-exported from `@zitadel/sdk-core`.
 *
 * The types are defined once in `@zitadel/sdk-core` and shared with the other server SDKs, so the
 * shape that {@link server!auth | auth} returns here matches the one the Nuxt, SvelteKit and
 * other SDKs return. They are documented in core, and this file adds nothing of its own.
 *
 * The token-bearing shapes ({@link ZitadelAuthSession}, {@link ZitadelAuthResult}) are for server code. The
 * client-safe shapes ({@link ZitadelClientSession}, {@link ZitadelClientAuthResult}) carry no token and are what
 * client components, {@link server!ZitadelProvider | ZitadelProvider} and
 * {@link session!getSession | getSession} deal in.
 */
export type {
  ZitadelAuthSession,
  ZitadelAuthState,
  ZitadelUnauthState,
  ZitadelAuthResult,
  ZitadelMiddlewareOptions,
  // Client-safe auth shapes returned by getSession() and read by useAuth(): the token is absent
  // on purpose.
  ZitadelClientSession,
  ZitadelClientAuthState,
  ZitadelClientAuthResult,
} from "@zitadel/sdk-core/middleware";
