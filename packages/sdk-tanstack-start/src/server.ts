/**
 * The server entry for TanStack Start apps.
 *
 * It exports the request middleware factory {@link createZitadelRequestMiddleware}, the plain decision
 * function {@link handleZitadelRequest} for a custom server entry, and {@link getAuth} to read
 * the signed-in user in a server function. It runs on Node.js and on edge runtimes such as
 * Cloudflare Workers and Vercel Edge, because it needs no Node built-ins.
 *
 * @module
 */
export { handleZitadelRequest, createZitadelRequestMiddleware, getAuth } from "./middleware";
export type {
  ZitadelRequestDecision,
  ZitadelRequestOptions,
  RequestMiddlewareContext,
} from "./middleware";
export type {
  ZitadelMiddlewareOptions,
  AuthResult,
  ZitadelAuthSession,
  AuthState,
  UnauthState,
  ClientAuthResult,
} from "./types.js";
