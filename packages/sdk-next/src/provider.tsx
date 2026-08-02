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
  return { userId: session.userId, email: session.email, name: session.name };
}

/**
 * Seeds client components (the `useAuth()` hook) with the server-known auth
 * state. Render it in a Server Component — typically the root layout — and
 * pass the `auth()` result directly:
 *
 * ```tsx
 * import { auth } from "@zitadel/sdk-next/server";
 * import { NextgenProvider } from "@zitadel/sdk-next/react";
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
 * This component is deliberately **not** marked `"use client"`. Rendered from
 * a Server Component it executes on the server, converts the input to the
 * client-safe {@link ClientAuthResult} — dropping the raw session token — and
 * only the stripped value is serialised across the server→client boundary.
 * Passing the full `auth()` result straight into a `"use client"` component
 * would embed the raw token in the RSC flight payload, readable by any script
 * running on the page. (sdk-nuxt strips the token before seeding client state
 * for the same reason.)
 *
 * Client components therefore only ever see `userId` / `email` / `name`. When
 * the raw token is needed server-side (e.g. to call an upstream API), read it
 * from `auth()` in a Server Component or Route Handler — never through this
 * provider.
 */
export function NextgenProvider({
  session,
  children,
}: {
  session: AuthResult | ClientAuthResult | ClientSession | NextgenSession | null;
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
