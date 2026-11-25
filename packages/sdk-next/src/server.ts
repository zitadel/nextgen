/**
 * The server-side entry of `@zitadel/sdk-next`, for Server Components, Route Handlers and other
 * server modules.
 *
 * It exposes {@link getAuth}, which reads and verifies the session during a render, and
 * {@link NextgenProvider}, which seeds client components with the token-less session. Both import
 * the `server-only` guard, so pulling this entry into a `"use client"` module graph fails the
 * build instead of shipping the session token to the browser. That failure is intentional: the
 * token that {@link getAuth} returns must never become client state.
 *
 * It also re-exports {@link createNextgenMiddleware} and the auth types for convenience, so a
 * server module can import them next to {@link getAuth}. Middleware itself belongs in the
 * `proxy.ts` file (`middleware.ts` on Next.js 15), which should import from
 * `@zitadel/sdk-next/middleware` to keep that file free of server-only code.
 *
 * Client Components do not import from here. They use `@zitadel/sdk-next/react` for {@link
 * react!useAuth | useAuth} and `@zitadel/sdk-next/session` for {@link session!getSession |
 * getSession}.
 *
 * @example
 * ```tsx
 * import { getAuth, NextgenProvider } from "@zitadel/sdk-next/server";
 * ```
 *
 * @module
 */
export { createNextgenMiddleware } from "./middleware.js";
export { getAuth } from "./auth.js";
export type { AuthOptions } from "./auth.js";
export { NextgenProvider } from "./provider.js";
export type {
  AuthResult,
  AuthState,
  UnauthState,
  NextgenSession,
  ClientAuthResult,
  NextgenMiddlewareOptions,
} from "./types.js";
