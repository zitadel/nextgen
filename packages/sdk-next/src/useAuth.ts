"use client";

import type { ClientAuthResult } from "./types.js";

import { useAuthContext } from "./context.js";

/**
 * Reads the auth state seeded by {@link NextgenProvider} in a client
 * component.
 *
 * Returns the client-safe {@link ClientAuthResult} (`userId` / `email` /
 * `name`) — the raw session token is stripped server-side by the provider
 * and is never available client-side. This is the same shape sdk-nuxt's
 * `useAuth()` and `getSession()` return.
 *
 * The value reflects what the server knew when the page rendered. For chrome
 * on pages outside the middleware `matcher` (where `auth()` reports signed
 * out), read the session live with `getSession()` from
 * `@zitadel/sdk-next/session` instead.
 */
export function useAuth(): ClientAuthResult {
  return useAuthContext();
}
