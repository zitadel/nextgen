"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { ClientAuthResult } from "./types.js";

const defaultValue: ClientAuthResult = { isAuthenticated: false, session: null };

/**
 * The React context that carries the client-safe auth state. It defaults to signed out, so a
 * component rendered outside a provider never throws.
 */
const ZitadelAuthContext = createContext<ClientAuthResult>(defaultValue);

/**
 * Provides a client-safe auth state to the client components below it.
 *
 * In the standard server-seeded setup, render {@link server!ZitadelProvider | ZitadelProvider}
 * from `@zitadel/sdk-next/server` instead. It converts the result of
 * {@link server!auth | auth} to the client-safe shape and drops the raw session token before
 * the value crosses the server-to-client boundary, and its `server-only` guard keeps it out of
 * client wrappers where the strip would come too late.
 *
 * Render this component directly only from client code that already holds a client-safe value,
 * for example a state seeded from a {@link session!getSession | getSession} read in an effect.
 * The `value` prop is typed as {@link ClientAuthResult}, which has no `token` field. The type
 * does not stop the token: the token-bearing result of {@link server!auth | auth} still compiles,
 * because TypeScript allows an extra property on a value that is not an object literal, and the
 * provider does not copy or strip the value. Strip it first with
 * {@link server!ZitadelProvider | ZitadelProvider}. Without any provider above,
 * {@link useAuth} reads as signed out.
 *
 * The file starts with `"use client"`. Keep that directive on the first line of the file.
 *
 * @param props - The `value` to provide and the `children` that read it.
 * @returns The children wrapped in the auth context.
 *
 * @example
 * ```tsx
 * "use client";
 * import { AuthContextProvider } from "@zitadel/sdk-next/react";
 * import type { ClientAuthResult } from "@zitadel/sdk-next/session";
 *
 * export function Seeded(props: { auth: ClientAuthResult; children: React.ReactNode }) {
 *   return <AuthContextProvider value={props.auth}>{props.children}</AuthContextProvider>;
 * }
 * ```
 */
export function AuthContextProvider({
  value,
  children,
}: {
  /**
   * The client-safe auth state that every {@link useAuth} call below this provider reads.
   *
   * It is typed as {@link ClientAuthResult}, which has no `token` field. A token-bearing result of
   * {@link server!auth | auth} still compiles here, and the provider does not copy or validate
   * the value, so pass an object that is already token-less.
   */
  value: ClientAuthResult;
  /**
   * The client subtree that reads the state with {@link useAuth}.
   */
  children: ReactNode;
}) {
  return <ZitadelAuthContext.Provider value={value}>{children}</ZitadelAuthContext.Provider>;
}

/**
 * Reads the auth state from the nearest {@link AuthContextProvider}, or the signed-out state when
 * none is rendered above the caller.
 *
 * {@link useAuth} is the same read under the name an app calls. This is the lower-level hook it
 * is built on, exported for code that wants the context without the public hook name. Prefer
 * {@link useAuth} in application code.
 *
 * @returns The client-safe {@link ClientAuthResult} of the nearest provider.
 *
 * @example
 * ```tsx
 * "use client";
 * import { useAuthContext } from "@zitadel/sdk-next/react";
 *
 * export function UserId() {
 *   const { session } = useAuthContext();
 *   return <span>{session?.userId ?? "anonymous"}</span>;
 * }
 * ```
 */
export function useAuthContext(): ClientAuthResult {
  return useContext(ZitadelAuthContext);
}
