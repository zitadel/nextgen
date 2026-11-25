/**
 * The server entry for TanStack Start apps.
 *
 * It exports the request middleware factory {@link createNextgenMiddleware}, the plain decision
 * function {@link handleNextgenRequest} for a custom server entry, and {@link getAuth} to read
 * the signed-in user in a server function. It runs on Node.js and on edge runtimes such as
 * Cloudflare Workers and Vercel Edge, because it needs no Node built-ins.
 *
 * @module
 */
export { handleNextgenRequest, createNextgenMiddleware, getAuth } from "./middleware";
export type {
  NextgenRequestDecision,
  NextgenRequestOptions,
  RequestMiddlewareContext,
} from "./middleware";
export type {
  NextgenMiddlewareOptions,
  AuthResult,
  NextgenSession,
  AuthState,
  UnauthState,
  ClientAuthResult,
} from "./types.js";
