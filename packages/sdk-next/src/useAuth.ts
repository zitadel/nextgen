"use client";

import type { AuthResult } from "./types";
import { useAuthContext } from "./context";

export function useAuth(): AuthResult {
  return useAuthContext();
}
