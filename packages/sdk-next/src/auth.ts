import { headers } from 'next/headers';

import type { AuthResult } from './types';

import { decodeJwt } from './lib/jwt';

/**
 * Reads the auth state in a React Server Component or Next.js Route Handler.
 *
 * - **JWT tokens** are decoded locally (no backend round-trip).
 * - **Opaque encrypted tokens** have already been validated by the
 *   middleware via `GET /sessions/me`. If the `x-nextgen-auth-token`
 *   header is set, the session is authentic. Session details (email,
 *   name) are not available server-side for opaque tokens — use the
 *   `/__nextgen/sessions/me` proxy from a client component to fetch them.
 *
 * ```ts
 * import { auth } from "@zitadel/sdk-next";
 *
 * export default async function Page() {
 *   const session = await auth();
 *   if (!session.isAuthenticated) return <p>Not signed in</p>;
 *   return <p>Hello {session.session.userId}</p>;
 * }
 * ```
 *
 * @returns The current {@link AuthResult}.
 */
export async function auth(): Promise<AuthResult> {
  const headerStore = await headers();
  const token = headerStore.get('x-nextgen-auth-token');

  if (!token) {
    return { isAuthenticated: false, session: null };
  }

  // Fast path: JWT token — decode locally.
  try {
    const { payload } = decodeJwt(token);
    if (payload.sub) {
      return {
        isAuthenticated: true,
        session: {
          userId: payload.sub,
          email: payload.email ?? null,
          name: payload.name ?? null,
          token,
        },
      };
    }
  } catch {
    // Not a JWT — opaque token validated by middleware.
  }

  // Opaque token path: the middleware already validated this token via
  // GET /sessions/me and only tunnelled it if the session is live.
  // We know the user is authenticated, but session details (email, name)
  // are not available server-side. Client components can fetch them via
  // the /__nextgen/sessions/me proxy.
  return {
    isAuthenticated: true,
    session: {
      userId: 'unknown',
      email: null,
      name: null,
      token,
    },
  };
}
