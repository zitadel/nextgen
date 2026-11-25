export { createZitadelHandle, getAuth } from "./server.js";
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
