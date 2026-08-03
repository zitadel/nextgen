/**
 * Client-safe React bindings for `@zitadel/sdk-next`.
 *
 * This is the entry point for `"use client"` components. It pulls in no
 * server-only modules (`next/headers`, `auth()`, `NextgenProvider`), so it is
 * safe to import anywhere.
 *
 * ```tsx
 * "use client";
 * import { useAuth } from "@zitadel/sdk-next/react";
 * ```
 *
 * `NextgenProvider` is deliberately **not** exported here: it accepts the
 * token-bearing `auth()` result, so it must execute in a Server Component —
 * wrapping it in a `"use client"` file would serialise the raw token across
 * the boundary before the provider strips it. Import it from
 * `@zitadel/sdk-next/server` (or the package root) instead; the `server-only`
 * guard turns a client-side import into a build error. To seed the context
 * from client-side state (e.g. a `getSession()` read), render
 * {@link AuthContextProvider}, which only accepts the token-less
 * `ClientAuthResult`.
 */
export { AuthContextProvider, useAuthContext } from "./context.js";
export { useAuth } from "./useAuth.js";
export type {
  AuthResult,
  AuthState,
  ClientAuthResult,
  ClientAuthState,
  ClientSession,
  NextgenSession,
  UnauthState,
} from "./types.js";
