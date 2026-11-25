/**
 * The main entry of the Qwik Router SDK.
 *
 * This entry re-exports the server API ({@link createNextgenMiddleware}, {@link getAuth}) and the
 * project configuration helpers ({@link configureZitadel}, {@link getApi},
 * {@link getZitadelConfig}), so an app that imports only from the package root gets everything.
 * Import from `@zitadel/sdk-qwik-router/server` in server code and from
 * `@zitadel/sdk-qwik-router/client` in browser code to keep each bundle to what it uses. The
 * server entry reads secrets and verifies sessions, so never import it from code that is
 * bundled for the browser.
 *
 * @example
 * ```ts
 * import { configureZitadel, createNextgenMiddleware } from "@zitadel/sdk-qwik-router";
 * ```
 *
 * @module
 */

export { createNextgenMiddleware, getAuth } from "./server.js";
export type { QwikRequestEvent, QwikCookieValue, QwikCookieOptions } from "./server.js";
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/sdk-core/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/sdk-core/config";
export type {
  NextgenMiddlewareOptions,
  AuthResult,
  NextgenSession,
  AuthState,
  UnauthState,
  ClientAuthResult,
} from "./types.js";
