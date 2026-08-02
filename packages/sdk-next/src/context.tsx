"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { ClientAuthResult } from "./types.js";

const defaultValue: ClientAuthResult = { isAuthenticated: false, session: null };

const NextgenAuthContext = createContext<ClientAuthResult>(defaultValue);

/**
 * Internal client-side context carrier. Use {@link NextgenProvider} from
 * `@zitadel/sdk-next/react` instead — it normalises the server's `auth()`
 * result to the client-safe shape (dropping the raw session token) *before*
 * the value crosses the server→client component boundary.
 *
 * The context value is deliberately typed as {@link ClientAuthResult}: the
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
