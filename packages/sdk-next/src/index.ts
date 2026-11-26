/**
 * The package root of `@zitadel/sdk-next`, for Server Components and other server modules only.
 *
 * The root exists so a server module can import everything it needs from one specifier. It
 * re-exports the middleware factories, the server-side {@link auth} reader, the server-side
 * {@link ZitadelProvider} and the client-safe hooks. Because it includes {@link auth}, which
 * imports the `server-only` guard, importing the root from a module that starts with
 * `"use client"` fails the build. Which bundlers print a useful import trace depends on their tree
 * shaking, so do not rely on the root being tree-shaken away from a client graph.
 *
 * Pick the entry by where the code runs instead. Client Components import {@link useAuth} from
 * `@zitadel/sdk-next/react` and {@link session!getSession | getSession} from
 * `@zitadel/sdk-next/session`. Middleware imports from `@zitadel/sdk-next/middleware`, which uses
 * only Web APIs and therefore runs on the edge. Server Components can import {@link auth} and
 * {@link ZitadelProvider} from `@zitadel/sdk-next/server`.
 *
 * @example
 * ```tsx
 * // app/layout.tsx, a Server Component.
 * import { auth, ZitadelProvider } from "@zitadel/sdk-next";
 * ```
 *
 * @module
 */
export * from "./types.js";
export { zitadelMiddleware, createProxy } from "./middleware.js";
export type { ZitadelProxyOptions, ZitadelProxyHandler } from "./middleware.js";
export { auth } from "./auth.js";
export type { ZitadelAuthOptions } from "./auth.js";
export { ZitadelProvider } from "./provider.js";
export { AuthContextProvider, useAuthContext } from "./context.js";
export { useAuth } from "./useAuth.js";
