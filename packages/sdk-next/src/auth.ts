import "server-only";

import { getZitadelConfig } from "@zitadel/api/config";
import { checkOpaqueSessionToken, jwtNamesProject } from "@zitadel/sdk-core/middleware";
import { headers } from "next/headers";
import { cache } from "react";

import type { AuthResult, NextgenMiddlewareOptions } from "./types.js";

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
  | "projectId"
  | "allowedAlgorithms"
  | "clockSkewMs"
  | "audience"
  | "allowedTokenTypes"
  | "jwksTimeoutMs"
  | "opaqueTokenTimeoutMs"
>;

/**
 * Checks an opaque (non-JWT) session token against the backend's
 * `GET /sessions/me`, held to `projectId` (see `checkOpaqueSessionToken` in
 * `@zitadel/sdk-core`, which the middleware uses too).
 *
 * Wrapped in React's `cache()` so that many components calling `auth()` in
 * the same render pass share a single backend round-trip. Arguments are
 * primitives on purpose — `cache()` memoises by argument identity.
 */
const checkOpaqueSession = cache(
  (token: string, issuerUrl: string, timeoutMs: number, projectId: string) =>
    checkOpaqueSessionToken(token, issuerUrl, timeoutMs, projectId),
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
 * `matcher` does not cover, the middleware cannot refuse a forged
 * client-supplied header, so `auth()` re-verifies every value it reads.
 * A header value that fails verification is treated as signed out.
 *
 * Either way a session counts only in the app's own project: `projectId`,
 * else `ZITADEL_PROJECT_ID`, else `NEXT_PUBLIC_ZITADEL_PROJECT_ID`, else the
 * project of `configureZitadel()` when it has run in this server runtime. A
 * JWT must name it in `aud`; an opaque token must be a session of that
 * project. With no project, nobody is signed in. A middleware built with
 * `createProxy(config)` holds sessions to `config.projectId`: pass the same
 * project here unless it comes from one of those variables.
 *
 * A backend that answers with an unexpected status, or not at all, reads as
 * signed out and is logged, so a broken proxy or an unreachable backend is
 * distinguishable from a missing session.
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
    projectId = process.env.ZITADEL_PROJECT_ID ||
      process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ||
      getZitadelConfig()?.projectId,
    allowedAlgorithms = ["RS256", "ES256"] as const,
    clockSkewMs = 5000,
    audience,
    allowedTokenTypes = ["JWT", "at+JWT"],
    jwksTimeoutMs,
    opaqueTokenTimeoutMs = 5000,
  } = options;

  if (!projectId) {
    warnMissingProject();
    return { isAuthenticated: false, session: null };
  }

  if (isJwtShaped(token)) {
    const payload = await verifyJwt(token, {
      issuerUrl: url,
      allowedAlgorithms,
      clockSkewMs,
      audience,
      allowedTokenTypes,
      jwksTimeoutMs,
    });

    if (payload?.sub && jwtNamesProject(payload, projectId)) {
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

    if (payload?.sub) {
      // Verified, but issued for another project: not a user of this one.
      return { isAuthenticated: false, session: null };
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

  // A refused session, an anonymous one and one of another project read as
  // signed out here. So does a check without a verdict, which
  // `checkOpaqueSessionToken` logs with its cause.
  const check = await checkOpaqueSession(token, url, opaqueTokenTimeoutMs, projectId);
  if (check.verdict === "live" && check.session.userId) {
    return {
      isAuthenticated: true,
      session: {
        userId: check.session.userId,
        identifier: check.session.identifier,
        identifierProperty: check.session.identifierProperty,
        display: check.session.display,
        token,
      },
    };
  }
  return { isAuthenticated: false, session: null };
}

let warnedMissingProject = false;

/** Says once per process why `auth()` signs no one in: no project is configured. */
function warnMissingProject(): void {
  if (warnedMissingProject) {
    return;
  }
  warnedMissingProject = true;
  console.warn(
    "[nextgen] auth(): no project id is configured, so no session counts as signed in. " +
      "Set ZITADEL_PROJECT_ID, or pass the middleware's `projectId` to auth() (with " +
      "createProxy(config), that is config.projectId).",
  );
}
