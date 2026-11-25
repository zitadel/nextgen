"use client";

import type { ClientAuthResult } from "./types.js";

import { useAuthContext } from "./context.js";

/**
 * Reads the signed-in state that {@link server!NextgenProvider | NextgenProvider} seeded, from a
 * Client Component.
 *
 * It returns the client-safe {@link ClientAuthResult}: `userId`, `identifier`,
 * `identifierProperty` and `display`. The raw session token is stripped on the server by the
 * provider and is never available in the browser, so an upstream API call that needs the token
 * must run on the server through {@link server!getAuth | getAuth}. The shape is the same one
 * `useAuth()` returns in `@zitadel/sdk-nuxt` and `getSession()` resolves with.
 *
 * The value is the state the server knew when the page rendered, and it does not change on its
 * own afterwards. Outside a provider it reads as signed out. It also reads as signed out on a
 * route the middleware `matcher` does not cover, because {@link server!getAuth | getAuth} cannot
 * see the session there. For chrome on such pages, read the session live with
 * {@link session!getSession | getSession} from `@zitadel/sdk-next/session` instead.
 *
 * @returns The {@link ClientAuthResult} of the nearest provider, or the signed-out state.
 *
 * @example
 * ```tsx
 * "use client";
 * import { useAuth } from "@zitadel/sdk-next/react";
 *
 * export function AccountLink() {
 *   const auth = useAuth();
 *   return auth.isAuthenticated ? (
 *     <a href="/profile">{auth.session.display ?? auth.session.identifier}</a>
 *   ) : (
 *     <a href="/login">Sign in</a>
 *   );
 * }
 * ```
 */
export function useAuth(): ClientAuthResult {
  return useAuthContext();
}
