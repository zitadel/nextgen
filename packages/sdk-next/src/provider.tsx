import "server-only";

import type { ReactNode } from "react";

import type {
  AuthResult,
  ClientAuthResult,
  ClientSession,
  ZitadelAuthSession,
  UnauthState,
} from "./types.js";

import { AuthContextProvider } from "./context.js";

/**
 * The signed-out state shared by every conversion that finds no signed-in user.
 */
const signedOut: UnauthState = { isAuthenticated: false, session: null };

/**
 * Converts a session to the client-safe shape by picking each field explicitly.
 *
 * It never spreads. The raw session token, and any server-only field added later, must not survive
 * the conversion, so a new field reaches the browser only when someone adds it here on purpose.
 *
 * @param session - A token-bearing or client-safe session.
 * @returns A session that holds only `userId`, `identifier`, `identifierProperty` and `display`.
 */
function toClientSession(session: ClientSession | ZitadelAuthSession): ClientSession {
  return {
    userId: session.userId,
    identifier: session.identifier,
    identifierProperty: session.identifierProperty,
    display: session.display,
  };
}

/**
 * Seeds client components with the server-known auth state, without the session token.
 *
 * Render it in a Server Component, typically the root layout, and pass the result of
 * {@link auth} directly. The client components below it then read the state with
 * {@link useAuth}, and the page needs no client-side fetch to know who is signed in on first paint.
 *
 * Run in a Server Component, it converts the input to the client-safe {@link ClientAuthResult},
 * which drops the raw session token, and only the stripped value is serialized across the
 * server-to-client boundary. Passing the full {@link auth} result straight into a
 * `"use client"` component would embed the raw token in the React Server Components flight
 * payload, where any script on the page can read it. `@zitadel/sdk-nuxt` strips the token before
 * it seeds client state for the same reason.
 *
 * This module is server-only on purpose. The strip protects the boundary only when it runs on the
 * server. If the component could be imported into a `"use client"` wrapper, such as the common
 * `providers.tsx` file, the wrapper would become the boundary and its still-unstripped `session`
 * prop, token included, would serialize into the payload before this code ran. The `server-only`
 * import turns that wrapper into a build error instead of a silent leak. To seed a client-side
 * tree, for example from {@link session!getSession | getSession}, use {@link AuthContextProvider}
 * from `@zitadel/sdk-next/react`, which accepts only the token-less {@link ClientAuthResult}.
 *
 * Client components therefore see only `userId`, `identifier`, `identifierProperty` and `display`.
 * The seeded state is the state at render time and does not update afterwards. On a route the
 * middleware `matcher` does not cover, {@link auth} reports signed out, so the seeded state is
 * signed out there too. When a server module needs the raw token, for example to call an upstream
 * API, read it from {@link auth} in a Server Component or Route Handler, never through this
 * provider.
 *
 * @param props - The `session` to seed and the `children` to render below it.
 * @returns The children wrapped in an {@link AuthContextProvider} that holds the client-safe
 *   state.
 *
 * @example
 * ```tsx
 * import { auth, ZitadelProvider } from "@zitadel/sdk-next/server";
 *
 * export default async function RootLayout({ children }: { children: React.ReactNode }) {
 *   const session = await auth();
 *   return (
 *     <html>
 *       <body>
 *         <ZitadelProvider session={session}>{children}</ZitadelProvider>
 *       </body>
 *     </html>
 *   );
 * }
 * ```
 */
export function ZitadelProvider({
  session,
  children,
}: {
  /**
   * The auth state to seed, normally the result of {@link auth}.
   *
   * A bare session, a client-safe result and `null` are accepted too, and `null` reads as signed
   * out. Only the client-safe fields survive the conversion: the raw token is dropped whatever
   * the input.
   */
  session: AuthResult | ClientAuthResult | ClientSession | ZitadelAuthSession | null;
  /**
   * The subtree whose client components read the state with {@link useAuth}.
   */
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
