/**
 * Re-exports the shared middleware types from `@zitadel/sdk-core`.
 *
 * The middleware-layer types are defined once in `@zitadel/sdk-core` and shared by every server
 * SDK, so their documentation lives there.
 */
export type {
  ZitadelAuthSession,
  ZitadelAuthState,
  ZitadelUnauthState,
  ZitadelAuthResult,
  ZitadelMiddlewareOptions,
  // Client-safe auth shapes (token absent), declared once in sdk-core.
  ZitadelClientSession,
  ZitadelClientAuthResult,
} from "@zitadel/sdk-core/middleware";
