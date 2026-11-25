export { createNextgenMiddleware, getAuth } from "./server.js";
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
