import { headers } from "next/headers";
import type { AuthResult } from "./types";
import { base64UrlDecode } from "./middleware";

interface JwtPayload {
  sub?: string;
  email?: string;
  name?: string;
  [key: string]: unknown;
}

/**
 * Reads the auth state in a React Server Component or Next.js Route Handler.
 *
 * The middleware verifies the JWT and tunnels it to the RSC runtime via
 * `x-nextgen-auth-token`. This function decodes the tunnelled token without
 * re-verifying the signature — verification has already been done by the
 * middleware on every request.
 *
 * ```ts
 * import { auth } from "@zitadel/sdk-next";
 *
 * export default async function Page() {
 *   const session = await auth();
 *   if (!session.isAuthenticated) return <p>Not signed in</p>;
 *   return <p>Hello {session.session.email}</p>;
 * }
 * ```
 *
 * @returns The current {@link AuthResult}.
 */
export async function auth(): Promise<AuthResult> {
  try {
    const headerStore = await headers();
    const token = headerStore.get("x-nextgen-auth-token");

    if (!token) {
      return { isAuthenticated: false, session: null };
    }

    const parts = token.split(".");
    if (parts.length < 3) {
      return { isAuthenticated: false, session: null };
    }

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(parts[1])),
    ) as JwtPayload;

    return {
      isAuthenticated: true,
      session: {
        userId: payload.sub ?? "",
        email: payload.email ?? null,
        name: payload.name ?? null,
        token,
      },
    };
  } catch {
    return { isAuthenticated: false, session: null };
  }
}
