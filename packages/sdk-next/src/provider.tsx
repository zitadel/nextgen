import "server-only";

import type { ReactNode } from "react";

import type {
  AuthResult,
  ClientAuthResult,
  ClientSession,
  NextgenSession,
  UnauthState,
} from "./types.js";

import { AuthContextProvider } from "./context.js";

const signedOut: UnauthState = { isAuthenticated: false, session: null };

/**
 * Explicit field pick — never a spread. The raw session token (and any future
 * server-only field) must not survive the conversion to the client shape.
 */
function toClientSession(session: ClientSession | NextgenSession): ClientSession {
  return {
    userId: session.userId,
    identifier: session.identifier,
    identifierProperty: session.identifierProperty,
    display: session.display,
  };
}

/**
 * Seeds client components (the `useAuth()` hook) with the server-known auth
 * state. Render it in a Server Component — typically the root layout — and
 * pass the `auth()` result directly:
 *
 * ```tsx
 * import { auth, NextgenProvider } from "@zitadel/sdk-next/server";
 *
 * export default async function RootLayout({ children }) {
 *   const session = await auth();
 *   return (
 *     <html>
 *       <body>
 *         <NextgenProvider session={session}>{children}</NextgenProvider>
 *       </body>
 *     </html>
 *   );
 * }
 * ```
 *
 * Executed in a Server Component, it converts the input to the client-safe
 * {@link ClientAuthResult} — dropping the raw session token — and only the
 * stripped value is serialised across the server→client boundary. Passing the
 * full `auth()` result straight into a `"use client"` component would embed
 * the raw token in the RSC flight payload, readable by any script running on
 * the page. (sdk-nuxt strips the token before seeding client state for the
 * same reason.)
 *
 * This module is **server-only, on purpose**. The strip only protects the
 * boundary when it runs on the server: if this component could be imported
 * into a `"use client"` wrapper (the common `providers.tsx` pattern), the
 * *wrapper* would become the boundary and its still-unstripped `session`
 * prop — token included — would serialise into the flight payload before
 * this code ever ran. The `server-only` import turns that wrapper into a
 * build error instead of a silent leak. For a client-seeded tree (e.g. state
 * from `getSession()`), use `AuthContextProvider` from
 * `@zitadel/sdk-next/react`, which only accepts the token-less
 * {@link ClientAuthResult}.
 *
 * Client components therefore only ever see `userId`, `identifier`,
 * `identifierProperty` and `display`. When the raw token is needed
 * server-side (e.g. to call an upstream API), read it from `auth()` in a
 * Server Component or Route Handler — never through this provider.
 *
 * @param props - The `session` to seed and the `children` to render below it.
 * @returns The children wrapped in an {@link AuthContextProvider} holding the
 *   client-safe state.
 */
export function NextgenProvider({
  session,
  children,
}: {
  /**
   * The auth state to seed, normally the result of `auth()`. A bare session, a
   * client-safe result or `null` (read as signed out) are accepted too. Only
   * the client-safe fields survive: the raw token is dropped whatever the input.
   */
  session: AuthResult | ClientAuthResult | ClientSession | NextgenSession | null;
  /** The subtree whose client components read the state with {@link useAuth}. */
  children: ReactNode;
}) {
  let value: ClientAuthResult;
  if (!session) {
    value = signedOut;
  } else if ("isAuthenticated" in session) {
    value = session.isAuthenticated
      ? { isAuthenticated: true, session: toClientSession(session.session) }
      : signedOut;
  } else {
    value = { isAuthenticated: true, session: toClientSession(session) };
  }

  return <AuthContextProvider value={value}>{children}</AuthContextProvider>;
}
