/**
 * The session and option types the middleware shares with every server SDK.
 *
 * Each type is defined once in `@zitadel/sdk-core` and re-exported here unchanged, so the same
 * shapes describe a session whichever framework SDK an app uses. The client-safe variants omit
 * the access token and are the only forms that may be sent to the browser.
 *
 * @module
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
