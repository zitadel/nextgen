export { createNextgenHandle, getAuth } from "./server.js";
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/api/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/api/config";
export type {
  NextgenMiddlewareOptions,
  AuthResult,
  NextgenSession,
  ClientAuthResult,
} from "./types.js";
