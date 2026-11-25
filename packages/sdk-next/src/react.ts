/**
 * The client-safe React bindings of `@zitadel/sdk-next`, for Client Components.
 *
 * This is the entry point for modules that start with `"use client"`. It pulls in no server-only
 * module (`next/headers`, {@link server!auth | auth}), so it is safe to import anywhere. It
 * exposes {@link useAuth} to read the signed-in state and {@link AuthContextProvider} to seed it
 * from client-side data.
 *
 * {@link server!ZitadelProvider | ZitadelProvider} is deliberately not exported here. It accepts
 * the token-bearing result of {@link server!auth | auth}, so it must run in a Server
 * Component: wrapping it in a `"use client"` file would serialize the raw session token across the
 * server-to-client boundary before the provider strips it, and any script on the page could read it
 * from the flight payload. Import it from `@zitadel/sdk-next/server` instead, where the
 * `server-only` guard turns a client-side import into a build error. To seed the context from
 * client-side state, such as a {@link session!getSession | getSession} read, render
 * {@link AuthContextProvider}, which is typed as the token-less {@link ZitadelClientAuthResult} and
 * strips nothing.
 *
 * @example
 * ```tsx
 * "use client";
 * import { useAuth } from "@zitadel/sdk-next/react";
 *
 * export function Greeting() {
 *   const auth = useAuth();
 *   return auth.isAuthenticated ? <p>Hello {auth.session.userId}</p> : <p>Signed out</p>;
 * }
 * ```
 *
 * @module
 */
export { AuthContextProvider, useAuthContext } from "./context.js";
export { useAuth } from "./useAuth.js";
export type {
  ZitadelAuthResult,
  ZitadelAuthState,
  ZitadelClientAuthResult,
  ZitadelClientAuthState,
  ZitadelClientSession,
  ZitadelAuthSession,
  ZitadelUnauthState,
} from "./types.js";
