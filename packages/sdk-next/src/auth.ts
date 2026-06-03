import { headers } from 'next/headers';

import type { AuthResult } from './types';

import { decodeJwt } from './lib/jwt';

/**
 * Reads the auth state in a React Server Component or Next.js Route Handler.
 *
 * Two paths:
 * 1. JWT token — decoded locally (no backend round-trip).
 * 2. Opaque encrypted token — validated by calling `GET /sessions/me` on the
 *    backend. The backend is the source of truth for opaque tokens.
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
    // Not a JWT — fall through to opaque token validation.
  }

  // Opaque token path: ask the backend to validate the session.
  const issuerUrl =
    process.env.NEXTGEN_ISSUER_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${issuerUrl}/sessions/me`, {
      method: 'GET',
      headers: { cookie: `__nextgen_session=${token}` },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (!res.ok) {
      return { isAuthenticated: false, session: null };
    }
    const session = (await res.json()) as { user_id?: string | null };
    const userId = session.user_id ?? null;
    if (!userId) {
      return { isAuthenticated: false, session: null };
    }
    return {
      isAuthenticated: true,
      session: {
        userId,
        email: null,
        name: null,
        token,
      },
    };
  } catch {
    return { isAuthenticated: false, session: null };
  }
}
