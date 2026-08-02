/**
 * Client-safe React bindings for `@zitadel/sdk-next`.
 *
 * This is the entry point for `"use client"` components. It pulls in no
 * server-only modules (`next/headers`, `auth()`), so it is safe to import
 * anywhere. The package root re-exports the same names for Server
 * Components, but importing the root from a client component fails at build
 * time — by design, because the root also exposes the server-only `auth()`.
 *
 * ```tsx
 * "use client";
 * import { useAuth } from "@zitadel/sdk-next/react";
 * ```
 */
export { NextgenProvider } from "./provider.js";
export { useAuth } from "./useAuth.js";
export { useAuthContext } from "./context.js";
export type {
  AuthResult,
  AuthState,
  ClientAuthResult,
  ClientAuthState,
  ClientSession,
  NextgenSession,
  UnauthState,
} from "./types.js";
