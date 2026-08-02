import "server-only";

import type { GetMySession200 } from "@zitadel/api/generated/model";

import { headers } from "next/headers";
import { cache } from "react";

import type { AuthResult, ClientSession, NextgenMiddlewareOptions } from "./types.js";

import { isJwtShaped, verifyJwt } from "./lib/jwt.js";

/**
 * Options for {@link auth}.
 *
 * These mirror the token-verification subset of the middleware options. When
 * the middleware runs with custom verification settings (a non-default
 * `audience`, `allowedAlgorithms`, …), pass the same values here — otherwise
 * a token the middleware accepted can fail re-verification in `auth()` and
 * render as signed out.
 */
export type AuthOptions = Pick<
  NextgenMiddlewareOptions,
  | "url"
  | "allowedAlgorithms"
  | "clockSkewMs"
  | "audience"
  | "allowedTokenTypes"
  | "jwksTimeoutMs"
  | "opaqueTokenTimeoutMs"
>;

/**
 * Validates an opaque (non-JWT) session token against the backend's
 * `GET /sessions/me` and returns the client-safe identity, or `null` when the
 * backend does not confirm a signed-in user.
 *
 * Wrapped in React's `cache()` so that many components calling `auth()` in
 * the same render pass share a single backend round-trip. Arguments are
 * primitives on purpose — `cache()` memoises by argument identity.
 *
 * Fail-closed: network errors, timeouts, and unexpected statuses all resolve
 * to `null` (signed out). Unexpected failures are logged so a broken proxy or
 * unreachable backend is distinguishable from a genuinely missing session.
 */
const validateOpaqueSession = cache(
  async (token: string, issuerUrl: string, timeoutMs: number): Promise<ClientSession | null> => {
    try {
      const res = await fetch(`${issuerUrl}/sessions/me`, {
        method: "GET",
        headers: { accept: "application/json", cookie: `__nextgen_session=${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });

      // 401 = no/invalid session token, 404 = session gone (revoked/expired):
      // both are the server's definitive "not signed in".
      if (res.status === 401 || res.status === 404) {
        return null;
      }

      if (!res.ok) {
        console.warn(
          `[nextgen] auth(): session validation failed with HTTP ${res.status} from ` +
            `${issuerUrl}/sessions/me — treating as signed out. If this persists, the ` +
            `backend URL is likely misconfigured (ZITADEL_URL or the \`url\` option).`,
        );
        return null;
      }

      const session = (await res.json()) as GetMySession200;

      // An anonymous session (no verified user factor yet) has no user_id —
      // for server-rendered UI that is "not signed in".
      if (!session.user_id) {
        return null;
      }

      return {
        userId: session.user_id,
        email: session.email ?? null,
        name: session.name ?? null,
      };
    } catch {
      console.warn(
        `[nextgen] auth(): could not reach ${issuerUrl}/sessions/me to validate the ` +
          `session token — treating as signed out.`,
      );
      return null;
    }
  },
);

/**
 * Reads the auth state in a React Server Component or Next.js Route Handler.
 *
 * The session token arrives on the `x-nextgen-auth-token` request header,
 * tunnelled there by the middleware — and `auth()` **verifies it before
 * trusting it**:
 *
 * - **JWT tokens** are verified cryptographically (signature via JWKS,
 *   issuer, expiry, algorithm and type allow-lists) using the same rules and
 *   defaults as the middleware. The JWKS is cached in-process, so this does
 *   not add a backend round-trip after the first call.
 * - **Opaque encrypted tokens** are validated against the backend's
 *   `GET /sessions/me`, which also supplies the user's identity (`userId`,
 *   `email`, `name`). The lookup is deduplicated per render pass via React
 *   `cache()`.
 *
 * The header alone is never proof of anything: on routes the middleware
 * `matcher` does not cover, the middleware cannot neutralise a forged
 * client-supplied header, so `auth()` re-verifies every value it reads.
 * A header value that fails verification is treated as signed out.
 *
 * **Matcher precondition (read this):** the middleware only tunnels the
 * session token on routes covered by its `matcher`. On uncovered routes the
 * cookie never reaches `auth()`, so `auth()` reports signed out even when a
 * live session exists. Either extend the `matcher` to every route that calls
 * `auth()`, or — for app chrome like headers and account menus — read the
 * session client-side with `getSession()` from `@zitadel/sdk-next/session`,
 * which works on any page.
 *
 * The backend URL comes from `options.url`, falling back to the same
 * `ZITADEL_URL` environment variable the middleware uses. If the middleware
 * runs with custom verification options (`audience`, `allowedAlgorithms`, …),
 * pass the same values here; see {@link AuthOptions}.
 *
 * This module is server-only: importing it (or the package root) from a
 * client component fails at build time. Client components read auth state
 * from `@zitadel/sdk-next/react` (`useAuth()`) or
 * `@zitadel/sdk-next/session` (`getSession()`).
 *
 * ```ts
 * import { auth } from "@zitadel/sdk-next/server";
 *
 * export default async function Page() {
 *   const session = await auth();
 *   if (!session.isAuthenticated) return <p>Not signed in</p>;
 *   return <p>Hello {session.session.userId}</p>;
 * }
 * ```
 *
 * @param options - Optional verification settings; see {@link AuthOptions}.
 * @returns The current {@link AuthResult}. `session.token` is the raw session
 *   token for calling upstream APIs server-side — never forward it into
 *   client components (the `NextgenProvider` strips it for you).
 */
export async function auth(options: AuthOptions = {}): Promise<AuthResult> {
  const headerStore = await headers();
  const token = headerStore.get("x-nextgen-auth-token");

  if (!token) {
    return { isAuthenticated: false, session: null };
  }

  const {
    url = process.env.ZITADEL_URL ?? "http://localhost:8080",
    allowedAlgorithms = ["RS256", "ES256"] as const,
    clockSkewMs = 5000,
    audience,
    allowedTokenTypes = ["JWT", "at+JWT"],
    jwksTimeoutMs,
    opaqueTokenTimeoutMs = 5000,
  } = options;

  if (isJwtShaped(token)) {
    const payload = await verifyJwt(token, {
      issuerUrl: url,
      allowedAlgorithms,
      clockSkewMs,
      audience,
      allowedTokenTypes,
      jwksTimeoutMs,
    });

    if (payload?.sub) {
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

    // A middleware-tunnelled JWT always verifies (the middleware applied the
    // same checks moments earlier). Reaching this branch means the header was
    // NOT vetted by the middleware — a route outside the `matcher` received a
    // client-forged header — or the JWKS endpoint is unreachable from this
    // runtime, or auth() runs with verification options that diverge from the
    // middleware's.
    console.warn(
      "[nextgen] auth(): rejected an x-nextgen-auth-token header that failed JWT " +
        "verification. If this route is not covered by the middleware matcher, this was " +
        "a forged client header; otherwise check that auth() and the middleware use the " +
        `same verification options and that the JWKS endpoint at ${url}/auth/keys is reachable.`,
    );
    return { isAuthenticated: false, session: null };
  }

  const session = await validateOpaqueSession(token, url, opaqueTokenTimeoutMs);
  if (session) {
    return { isAuthenticated: true, session: { ...session, token } };
  }

  return { isAuthenticated: false, session: null };
}
