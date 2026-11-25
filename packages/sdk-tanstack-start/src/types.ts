/**
 * The shared middleware types, re-exported from `@zitadel/sdk-core`.
 *
 * The middleware-layer types are defined once in `@zitadel/sdk-core` and shared by every server
 * SDK, so a session, an auth result and the middleware options have the same shape in each.
 * Their documentation lives with the definitions in core.
 *
 * @module
 */
export type {
  ZitadelAuthSession,
  AuthState,
  UnauthState,
  AuthResult,
  ZitadelMiddlewareOptions,
  // The client-safe auth shapes, which carry no token.
  ClientSession,
  ClientAuthState,
  ClientAuthResult,
} from "@zitadel/sdk-core/middleware";
