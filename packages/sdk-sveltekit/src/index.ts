export { createZitadelHandle, getAuth } from "./server.js";
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/sdk-core/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/sdk-core/config";
export type {
  ZitadelMiddlewareOptions,
  AuthResult,
  ZitadelAuthSession,
  AuthState,
  UnauthState,
  ClientAuthResult,
} from "./types.js";
