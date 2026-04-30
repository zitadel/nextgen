"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AuthResult, NextgenSession } from "./types";

const defaultValue: AuthResult = { isAuthenticated: false, session: null };

const NextgenAuthContext = createContext<AuthResult>(defaultValue);

export function NextgenProvider({
  session,
  children,
}: {
  session: AuthResult | NextgenSession | null;
  children: ReactNode;
}) {
  let value: AuthResult;
  if (!session) {
    value = { isAuthenticated: false, session: null };
  } else if ("isAuthenticated" in session) {
    value = session as AuthResult;
  } else {
    value = { isAuthenticated: true, session: session as NextgenSession };
  }

  return <NextgenAuthContext.Provider value={value}>{children}</NextgenAuthContext.Provider>;
}

export function useAuthContext(): AuthResult {
  return useContext(NextgenAuthContext);
}
