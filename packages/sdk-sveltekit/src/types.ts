/**
 * Re-exports the shared middleware types from `@zitadel/sdk-core`.
 *
 * The middleware-layer types are defined once in `@zitadel/sdk-core` and shared by every server
 * SDK, so their documentation lives there.
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
