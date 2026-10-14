export { createNextgenHandle, getAuth, getClientAuth } from "./server.js";
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/api/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/api/config";
export type {
  NextgenMiddlewareOptions,
  AuthResult,
  NextgenSession,
  AuthState,
  UnauthState,
  UnauthReason,
  ClientSession,
  ClientAuthState,
  ClientAuthResult,
} from "./types.js";
