/**
 * Server entry of the Qwik Router SDK: the `onRequest` handler that proxies
 * `/__nextgen/*`, verifies the session and guards routes, and {@link getAuth}
 * to read the result from a loader, action or endpoint.
 *
 * @module
 */

export { createNextgenOnRequest, getAuth } from "./request-handler";
export type { QwikRequestEvent, QwikCookieValue, QwikCookieOptions } from "./request-handler";
export type {
  NextgenMiddlewareOptions,
  AuthResult,
  NextgenSession,
  AuthState,
  UnauthState,
  ClientAuthResult,
} from "./types.js";
