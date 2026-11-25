/**
 * The server entry of the Qwik Router SDK.
 *
 * This entry exposes {@link createZitadelOnRequest}, which builds the `onRequest` handler that
 * proxies `/__nextgen/*`, verifies the session and guards routes, and {@link getAuth}, which
 * reads the result from a loader, action or endpoint. It reads the project secret and verifies
 * tokens, so import it only in server code.
 *
 * @example
 * ```ts
 * import { createZitadelOnRequest, getAuth } from "@zitadel/sdk-qwik-router/server";
 * ```
 *
 * @module
 */

export { createZitadelOnRequest, getAuth } from "./request-handler";
export type { QwikRequestEvent, QwikCookieValue, QwikCookieOptions } from "./request-handler";
export type {
  ZitadelMiddlewareOptions,
  AuthResult,
  ZitadelAuthSession,
  AuthState,
  UnauthState,
  ClientAuthResult,
} from "./types.js";
