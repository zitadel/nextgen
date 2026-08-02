"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { ClientAuthResult } from "./types.js";

const defaultValue: ClientAuthResult = { isAuthenticated: false, session: null };

const NextgenAuthContext = createContext<ClientAuthResult>(defaultValue);

/**
 * Client-side context carrier. In the standard server-seeded setup, render
 * {@link NextgenProvider} from `@zitadel/sdk-next/server` instead — it
 * normalises the server's `auth()` result to the client-safe shape (dropping
 * the raw session token) *before* the value crosses the server→client
 * component boundary, and its `server-only` guard keeps it out of client
 * wrappers where that strip would come too late.
 *
 * Render this component directly only from client code that already holds a
 * client-safe value — e.g. seeding from a `getSession()` read.
 *
 * The `value` prop is deliberately typed as {@link ClientAuthResult}: the
 * raw session token must never enter client-side state.
 */
export function AuthContextProvider({
  value,
  children,
}: {
  value: ClientAuthResult;
  children: ReactNode;
}) {
  return <NextgenAuthContext.Provider value={value}>{children}</NextgenAuthContext.Provider>;
}

export function useAuthContext(): ClientAuthResult {
  return useContext(NextgenAuthContext);
}
