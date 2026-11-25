/**
 * The root entry of the TanStack Start SDK.
 *
 * It re-exports the server API from `@zitadel/sdk-tanstack-start/server` and the project
 * configuration from `@zitadel/sdk-tanstack-start/client`, so a server-only module can import
 * everything from one place. Import the React components from
 * `@zitadel/sdk-tanstack-start/react`, which loads the web components in the browser.
 *
 * @module
 */
export { handleNextgenRequest, createNextgenMiddleware, getAuth } from "./server.js";
export type {
  NextgenRequestDecision,
  NextgenRequestOptions,
  RequestMiddlewareContext,
} from "./server.js";
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
