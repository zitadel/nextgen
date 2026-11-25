/**
 * Main entry of the Qwik Router SDK. It re-exports the server API
 * ({@link createNextgenOnRequest}, {@link getAuth}) and the project
 * configuration helpers, so an app that imports only from the package root
 * gets everything. Import from `@zitadel/sdk-qwik-router/server` in server
 * code and `@zitadel/sdk-qwik-router/client` in browser code to keep each
 * bundle to what it uses.
 *
 * @module
 */

export { createNextgenOnRequest, getAuth } from "./server.js";
export type { QwikRequestEvent, QwikCookieValue, QwikCookieOptions } from "./server.js";
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/api/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/api/config";
export type {
  NextgenMiddlewareOptions,
  AuthResult,
  NextgenSession,
  AuthState,
  UnauthState,
  ClientAuthResult,
} from "./types.js";
