import "server-only";

import { getZitadelConfig } from "@zitadel/sdk-core/config";
import { checkOpaqueSessionToken, jwtNamesProject } from "@zitadel/sdk-core/middleware";
import { joinURL } from "ufo";
import { headers } from "next/headers";
import { cache } from "react";

import type { AuthResult, ZitadelMiddlewareOptions } from "./types.js";

import { isJwtShaped, verifyJwt } from "./lib/jwt.js";

/**
 * Options for {@link auth}, the token-verification subset of the middleware options.
 *
 * The middleware verifies a session token before it tunnels it, and {@link auth} verifies it
 * again, so both must apply the same rules. When the middleware runs with custom verification
 * settings, such as a non-default `audience` or `allowedAlgorithms`, pass the same values here.
 * Otherwise a token the middleware accepted can fail re-verification in {@link auth} and render
 * as signed out, with only a console warning to explain it. Each option has the meaning and the
 * default documented on {@link ZitadelMiddlewareOptions}.
 *
 * @example
 * ```ts
 * import { auth, type AuthOptions } from "@zitadel/sdk-next/server";
 *
 * const options: AuthOptions = {
 *   projectId: process.env.ZITADEL_PROJECT_ID,
 *   audience: "https://api.example.com",
 * };
 * const session = await auth(options);
 * ```
 */
export type AuthOptions = Pick<
  ZitadelMiddlewareOptions,
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
 * Checks an opaque (non-JWT) session token against the backend's `GET /api/v1/sessions/me`, held
 * to `projectId`.
 *
 * It wraps `checkOpaqueSessionToken` from `@zitadel/sdk-core`, which the middleware uses too, in
 * React's `cache()`. Many components that call {@link auth} in the same render pass then share a
 * single backend round trip. The arguments are primitives on purpose, because `cache()` memoizes
 * by argument identity: an options object would defeat the deduplication.
 */
const checkOpaqueSession = cache(
  (token: string, issuerUrl: string, timeoutMs: number, projectId: string) =>
    checkOpaqueSessionToken(token, issuerUrl, timeoutMs, projectId),
);

/**
 * Reads and verifies the auth state in a React Server Component or a Next.js Route Handler.
 *
 * The middleware tunnels the session token to the render on the internal `x-zitadel-auth-token`
 * request header, and this function verifies the token before it trusts it. The header alone is
 * never proof of anything, so every value it reads is verified:
 *
 * - A JWT is verified cryptographically: signature through the JWKS, issuer, expiry, and the
 *   algorithm and type allow-lists, by the same rules and defaults as the middleware. The JWKS is
 *   cached in the process, so this adds no backend round trip after the first call.
 * - An opaque encrypted token is checked against the backend's `GET /api/v1/sessions/me`, which
 *   also supplies the identity (`userId`, `identifier`, `identifierProperty`, `display`). The
 *   check is deduplicated per render pass through React `cache()`, so many calls cost one request.
 *
 * Off a protected route the middleware hands an opaque token on unchecked, so a page that never
 * reads the session costs no backend call. There this function is the one check, and a page that
 * calls it pays one request for a live session. On a protected route the middleware has already
 * checked the token, so the render checks it a second time.
 *
 * A session counts only in the app's own project. The project is `options.projectId`, else
 * `ZITADEL_PROJECT_ID`, else `NEXT_PUBLIC_ZITADEL_PROJECT_ID`, else the project of
 * `configureZitadel()` when it has run in this server runtime. A JWT must name the project in
 * `aud`. An opaque token must belong to a session of that project. A session of another project on
 * the same host reads as signed out, because a browser sends one host's cookies to every app on
 * it. With no project known, nobody is signed in and the first call logs a warning. A middleware
 * built with {@link createProxy} holds sessions to `config.projectId`, so pass the same project
 * here unless it comes from one of those variables. The middleware's handle may not be configured
 * in the server runtime, which is why the project is not taken from it automatically.
 *
 * A header value that fails verification reads as signed out. A backend that answers with an
 * unexpected status, or does not answer within `opaqueTokenTimeoutMs`, also reads as signed out
 * and is logged, so a broken proxy or an unreachable backend can be told apart from a missing
 * session. A failed JWT check logs a warning that names the usual causes: a forged header on a
 * route the `matcher` does not cover, an unreachable JWKS endpoint, or verification options that
 * differ from the middleware's.
 *
 * Matcher precondition: the middleware tunnels the token only on routes its `matcher` covers. On
 * an uncovered route the cookie never reaches this function, so it reports signed out even when a
 * live session exists, and the middleware cannot refuse a client-forged header there either. Make
 * the `matcher` cover every route that calls this function. The recommended pattern covers every
 * route except the Next.js build files. For app chrome such as headers and account menus, read the
 * session in the browser with {@link session!getSession | getSession} from
 * `@zitadel/sdk-next/session` instead, which works on any page.
 *
 * The backend URL comes from `options.url`, else the `ZITADEL_URL` environment variable the
 * middleware reads, else `http://localhost:8080`. An empty value counts as unset. Reading
 * `headers()` makes the route dynamic, so a page that calls this function is rendered per request and cannot be statically generated.
 *
 * This module is server-only. Importing it, or the package root, from a client component fails
 * the build. Client components read the state through {@link useAuth} from
 * `@zitadel/sdk-next/react` or through {@link session!getSession | getSession}.
 *
 * Naming: auth() reads the request from the async context that Next.js provides (headers()), so
 * it takes no request argument and is async. The other SDKs' getAuth(event) are synchronous and
 * need the framework's event handed to them, which is why the two names differ.
 *
 * @param options - Verification settings, which must match the middleware's; see
 *   {@link AuthOptions}.
 * @returns The current {@link AuthResult}. The `session.token` is the raw session token, for
 *   calling upstream APIs from the server. Never forward it into a client component:
 *   {@link ZitadelProvider} strips it for you.
 *
 * @example
 * ```tsx
 * import { auth } from "@zitadel/sdk-next/server";
 *
 * export default async function Page() {
 *   const session = await auth();
 *   if (!session.isAuthenticated) {
 *     return <p>Not signed in</p>;
 *   }
 *   return <p>Hello {session.session.userId}</p>;
 * }
 * ```
 */
export async function auth(options: AuthOptions = {}): Promise<AuthResult> {
  const headerStore = await headers();
  const token = headerStore.get("x-zitadel-auth-token");

  if (!token) {
    return { isAuthenticated: false, session: null };
  }

  const {
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
  const url = options.url || process.env.ZITADEL_URL || "http://localhost:8080";

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
      "[zitadel] auth(): rejected an x-zitadel-auth-token header that failed JWT " +
        "verification. If this route is not covered by the middleware matcher, this was " +
        "a forged client header; otherwise check that auth() and the middleware use the " +
        `same verification options and that the JWKS endpoint at ${joinURL(url, "/auth/keys")} is reachable.`,
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

/**
 * Warns once per process that no project id is configured, which is why {@link auth} signs no
 * one in. Logging once keeps a misconfigured app from flooding its server log on every render.
 */
function warnMissingProject(): void {
  if (warnedMissingProject) {
    return;
  }
  warnedMissingProject = true;
  console.warn(
    "[zitadel] auth(): no project id is configured, so no session counts as signed in. " +
      "Set ZITADEL_PROJECT_ID, or pass the middleware's `projectId` to auth() (with " +
      "createProxy(config), that is config.projectId).",
  );
}
