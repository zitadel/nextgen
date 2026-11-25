/**
 * The package root of `@zitadel/sdk-next`, for Server Components and other server modules only.
 *
 * The root exists so a server module can import everything it needs from one specifier. It
 * re-exports the middleware factories, the server-side {@link getAuth} reader, the server-side
 * {@link NextgenProvider} and the client-safe hooks. Because it includes {@link getAuth}, which
 * imports the `server-only` guard, importing the root from a module that starts with
 * `"use client"` fails the build. Which bundlers print a useful import trace depends on their tree
 * shaking, so do not rely on the root being tree-shaken away from a client graph.
 *
 * Pick the entry by where the code runs instead. Client Components import {@link useAuth} from
 * `@zitadel/sdk-next/react` and {@link session!getSession | getSession} from
 * `@zitadel/sdk-next/session`. Middleware imports from `@zitadel/sdk-next/middleware`, which uses
 * only Web APIs and therefore runs on the edge. Server Components can import {@link getAuth} and
 * {@link NextgenProvider} from `@zitadel/sdk-next/server`.
 *
 * @example
 * ```tsx
 * // app/layout.tsx, a Server Component.
 * import { getAuth, NextgenProvider } from "@zitadel/sdk-next";
 * ```
 *
 * @module
 */
export * from "./types.js";
export { createNextgenMiddleware, createProxy } from "./middleware.js";
export type { ProxyOptions, ProxyHandler } from "./middleware.js";
export { getAuth } from "./auth.js";
export type { AuthOptions } from "./auth.js";
export { NextgenProvider } from "./provider.js";
export { AuthContextProvider, useAuthContext } from "./context.js";
export { useAuth } from "./useAuth.js";
