export { handleNextgenRequest, createNextgenRequestMiddleware, getAuth } from "./server.js";
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
