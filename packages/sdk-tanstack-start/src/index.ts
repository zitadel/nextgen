/**
 * The root entry of the TanStack Start SDK.
 *
 * It re-exports the server API from `@zitadel/sdk-tanstack-start/server` and the project
 * configuration from `@zitadel/sdk-tanstack-start/client`, so a server-only module can import
 * everything from one place. Import the React components from
 * `@zitadel/sdk-tanstack-start/components`, which loads the web components in the browser.
 *
 * @module
 */
export { handleZitadelRequest, createZitadelRequestMiddleware, getAuth } from "./server.js";
export type {
  ZitadelRequestResult,
  ZitadelRequestOptions,
  ZitadelRequestMiddlewareContext,
} from "./server.js";
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/sdk-core/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/sdk-core/config";
export type {
  ZitadelMiddlewareOptions,
  ZitadelAuthResult,
  ZitadelAuthSession,
  ZitadelAuthState,
  ZitadelUnauthState,
  ZitadelClientAuthResult,
} from "./types.js";
