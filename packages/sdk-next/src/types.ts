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
} from '@zitadel/sdk-core/middleware';
