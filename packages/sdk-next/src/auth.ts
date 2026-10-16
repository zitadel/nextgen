import "server-only";

import { toClientAuth, validateOpaqueSessionToken } from "@zitadel/sdk-core/middleware";
import { headers } from "next/headers";
import { cache } from "react";

import type {
  AuthResult,
  ClientAuthResult,
  ClientSession,
  NextgenMiddlewareOptions,
} from "./types.js";

import { checkJwt, isJwtShaped } from "./lib/jwt.js";

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
 * `GET /sessions/me` (sdk-core's {@link validateOpaqueSessionToken}, shared by
 * every server SDK) and returns the client-safe identity, or `null` when the
 * backend does not confirm a signed-in user.
 *
 * Wrapped in React's `cache()` so that many components calling `auth()` in
 * the same render pass share a single backend round-trip. Arguments are
 * primitives on purpose — `cache()` memoises by argument identity.
 *
 * Fail-closed: a dead session (401/404) and an anonymous one (no user yet) are
 * signed out. So is a backend that cannot answer — a network error, a timeout
 * or a 5xx — which sdk-core logs, so a broken proxy or unreachable backend is
 * distinguishable from a genuinely missing session; that outcome is returned
 * as `"unavailable"` so `auth()` can say so. `auth()` never clears the cookie,
 * so the session survives the outage.
 */
const validateOpaqueSession = cache(
  async (
    token: string,
    issuerUrl: string,
    timeoutMs: number,
  ): Promise<ClientSession | "unavailable" | null> => {
    const check = await validateOpaqueSessionToken(token, issuerUrl, timeoutMs);
    if (check.status === "unknown") {
      return "unavailable";
    }
    // An anonymous session (no verified user factor yet) has no user id —
    // for server-rendered UI that is "not signed in".
    if (check.status === "dead" || !check.session.userId) {
      return null;
    }
    return {
      userId: check.session.userId,
      identifier: check.session.identifier,
      identifierProperty: check.session.identifierProperty,
      display: check.session.display,
    };
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
 *   `identifier`, `display`). The lookup is deduplicated per render pass via
 *   React `cache()`.
 *
 * The token header alone is never proof of a session: on routes the
 * middleware `matcher` does not cover, the middleware cannot neutralise a
 * forged client-supplied header, so `auth()` re-verifies every token it reads.
 * A token that fails verification is treated as signed out.
 *
 * The state header (`x-nextgen-auth-state`), by which the middleware reports a
 * session it could not check, is trusted only on routes the middleware covers,
 * where it always overwrites it. On a route outside the `matcher`, a client can
 * send `x-nextgen-auth-state: unavailable` itself and `auth()` then reports
 * `reason: "unavailable"` for that request. That can only make the sender's own
 * request look like an outage (a `503` from your guard, without the
 * middleware's warning in the log); it never signs anyone in. Cover every route
 * that calls `auth()` with the `matcher` to rule it out.
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
 *   if (!session.isAuthenticated) {
 *     // The session could not be checked: an outage, not a sign-out.
 *     if (session.reason === "unavailable") return <p>Try again shortly</p>;
 *     return <p>Not signed in</p>;
 *   }
 *   return <p>Hello {session.session.userId}</p>;
 * }
 * ```
 *
 * When the backend cannot be asked (unreachable, too slow or failing), the
 * result is `{ isAuthenticated: false, reason: "unavailable" }` and the cookie
 * is kept: answer a retryable error rather than redirecting to the login page.
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
    // The middleware could not check the session (the backend is unreachable,
    // slow or failing); it kept the cookie and says so on this header.
    return headerStore.get("x-nextgen-auth-state") === "unavailable"
      ? { isAuthenticated: false, session: null, reason: "unavailable" }
      : { isAuthenticated: false, session: null };
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
    const jwt = await checkJwt(token, {
      issuerUrl: url,
      allowedAlgorithms,
      clockSkewMs,
      audience,
      allowedTokenTypes,
      jwksTimeoutMs,
    });
    if (jwt.status === "unavailable") {
      // This runtime cannot fetch the JWKS and has no keys cached: the token
      // may well be good, so this is an outage, not a sign-out.
      return { isAuthenticated: false, session: null, reason: "unavailable" };
    }
    const payload = jwt.status === "valid" ? jwt.payload : null;

    if (payload?.sub) {
      return {
        isAuthenticated: true,
        session: {
          userId: payload.sub,
          identifier: payload.email ?? null,
          identifierProperty: null,
          display: payload.name ?? null,
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
  if (session === "unavailable") {
    return { isAuthenticated: false, session: null, reason: "unavailable" };
  }
  if (session) {
    return { isAuthenticated: true, session: { ...session, token } };
  }

  return { isAuthenticated: false, session: null };
}

/**
 * The auth state of {@link auth} without the session token: safe to return
 * from a server action or to pass as a prop to a client component, both of
 * which Next.js serialises to the browser. The backend sets the token as an
 * HttpOnly cookie, and returning it would hand it to any script on the page.
 *
 * ```ts
 * "use server";
 * import { getClientAuth } from "@zitadel/sdk-next/server";
 *
 * export async function whoAmI() {
 *   return getClientAuth();
 * }
 * ```
 *
 * @param options - Optional verification settings; see {@link AuthOptions}.
 * @returns The current {@link ClientAuthResult}, with `reason` when the session
 *   could not be checked.
 */
export async function getClientAuth(options: AuthOptions = {}): Promise<ClientAuthResult> {
  return toClientAuth(await auth(options));
}
