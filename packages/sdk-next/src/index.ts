/**
 * Package root — for **Server Components and server modules only**: it
 * includes the server-only `auth()`, so importing it from a `"use client"`
 * module fails at build time. Client components import from
 * `@zitadel/sdk-next/react` (provider + hooks) or
 * `@zitadel/sdk-next/session` (`getSession()`) instead.
 */
export * from "./types.js";
export { nextgenMiddleware, createProxy } from "./middleware.js";
export type { ProxyOptions, ProxyHandler } from "./middleware.js";
export { auth } from "./auth.js";
export type { AuthOptions } from "./auth.js";
export { NextgenProvider } from "./provider.js";
export { useAuthContext } from "./context.js";
export { useAuth } from "./useAuth.js";
export { getSession } from "./session.js";
export type { GetSessionOptions } from "./session.js";
