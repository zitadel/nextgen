/**
 * The browser entry of `@zitadel/sdk-next` for reading the signed-in user from a Client Component.
 *
 * It exposes {@link getSession}, which asks the server who is signed in through the same-origin
 * proxy path. It works on any page, including routes the middleware `matcher` does not cover,
 * where the server-side {@link server!auth | auth} cannot see the session. The result
 * carries no session token.
 *
 * @module
 */
import { getZitadelConfig } from "@zitadel/sdk-core/config";
import { getSession as readSession } from "@zitadel/sdk-core/session";

import type { ClientAuthResult } from "./types.js";

/**
 * Options for {@link getSession}.
 *
 * Both fields fall back to the configuration of the page, so an app that calls
 * `configureZitadel()` before the read can pass nothing.
 */
export type GetSessionOptions = {
  /**
   * The same-origin proxy path that the request boundary forwards to the Zitadel backend.
   *
   * The browser never calls Zitadel directly, so the read goes to this path on the app's own
   * origin. The middleware must be mounted for it, which the scaffolded `proxy.ts` always does.
   * Set it only when the proxy lives somewhere other than the default, for example `"/auth-proxy"`
   * together with a matching `proxyPath` on the middleware.
   *
   * @defaultValue The path from `configureZitadel()` when it has run on this page, else
   * `"/__nextgen"`.
   */
  proxyPath?: string;

  /**
   * The project id this app signs its users in to.
   *
   * A session of another project reads as signed out, because a browser shares one host's cookies
   * across every app on it. Set it when `configureZitadel()` has not run on the page. With no
   * project id from any source, nobody reads as signed in, the same as on the server, and the
   * first call logs a warning.
   *
   * @defaultValue The project from `configureZitadel()` when it has run on this page, else
   * `NEXT_PUBLIC_ZITADEL_PROJECT_ID`, which Next.js inlines into the bundle at build time.
   */
  projectId?: string;
};

/**
 * Reads `NEXT_PUBLIC_ZITADEL_PROJECT_ID`, which Next.js inlines into client bundles at build time.
 *
 * The read is defensive: where the variable was not inlined, `process` may not exist in the
 * browser, and the access would throw.
 *
 * @returns The project id, or `undefined` when it is unset or `process` is missing.
 */
function publicProjectId(): string | undefined {
  try {
    return process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID || undefined;
  } catch {
    return undefined;
  }
}

let warnedMissingProject = false;

/**
 * Warns once per page that no project id is known, which is why {@link getSession} signs no one
 * in.
 */
function warnMissingProject(): void {
  if (warnedMissingProject) {
    return;
  }
  warnedMissingProject = true;
  console.warn(
    "[zitadel] getSession(): no project id is known, so no session counts as signed in. " +
      "Pass `projectId` (e.g. process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID) or call " +
      "configureZitadel() first.",
  );
}

/**
 * Reads the current session state from the browser, so an app's own UI knows whether a user is
 * signed in and who they are.
 *
 * Use it for chrome such as header navigation and account menus, and for any page the middleware
 * `matcher` does not cover. It fetches the same-origin
 * `{proxyPath}/api/v1/sessions/me?project_id=...` with credentials and `cache: "no-store"`, the
 * same read the `<zitadel-session>` card performs, so the answer is the server's and not a
 * client-side guess. Unlike server-side {@link server!auth | auth}, it does not require the
 * route to be covered by the middleware `matcher`. Only the proxy path itself must be matched,
 * which the scaffolded request boundary always does. It throws on the server, because there is no
 * browser to read from. In a Server Component or Route Handler use
 * {@link server!auth | auth}.
 *
 * A session counts only in the app's own project: `options.projectId`, else the project of
 * `configureZitadel()`, else `NEXT_PUBLIC_ZITADEL_PROJECT_ID`. With none of them it reads as
 * signed out without asking the server. The result is the client-safe shape: `userId`,
 * `identifier`, `identifierProperty` and `display`, with no token.
 *
 * How the response maps to a result:
 *
 * - `200` with an authenticated user resolves to `{ isAuthenticated: true, session }`.
 * - `200` for an anonymous session, `401` with `auth.unauthorized`, `403` with
 *   `sess.project_mismatch`, and `404` with `sess.not_found` all resolve to signed out. The `403`
 *   answers a session of another project on the same server. A `200` that names another project,
 *   from a server that predates the `project_id` parameter, reads as signed out too.
 * - Any other response rejects, including a framework's HTML 404 page from a misrouted proxy and
 *   a `404 req.not_found` from a server that does not serve the API under `/api/v1`. A failing
 *   proxy is a misconfiguration and must not silently render as signed out.
 *
 * Treat a rejection as "unknown", which is distinct from signed out, and render neutral chrome
 * instead of a sign-in link, as the example does.
 *
 * Sign-in and sign-out both navigate in the scaffolded setup, so chrome that calls this function
 * re-reads on the next page load. To react in place instead, listen for the widgets'
 * `zitadel-signout` and `zitadel-flow-complete` events and read again.
 *
 * @param options - The proxy path and project id; see {@link GetSessionOptions}.
 * @returns The current {@link ClientAuthResult}.
 * @throws When called outside a browser, or when the server answers with an unexpected response.
 *
 * @example
 * ```tsx
 * "use client";
 * import { useEffect, useState } from "react";
 * import { getSession, type ClientAuthResult } from "@zitadel/sdk-next/session";
 *
 * export function HeaderNav() {
 *   // undefined means not yet known: render neutral chrome, not "Sign in".
 *   const [auth, setAuth] = useState<ClientAuthResult>();
 *   const [failed, setFailed] = useState(false);
 *   useEffect(() => {
 *     getSession({ projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID }).then(setAuth, () =>
 *       setFailed(true),
 *     );
 *   }, []);
 *   if (failed) {
 *     return <span role="alert">Session unavailable</span>;
 *   }
 *   if (!auth) {
 *     return null;
 *   }
 *   return auth.isAuthenticated ? (
 *     <a href="/profile">{auth.session.display ?? auth.session.identifier ?? "Account"}</a>
 *   ) : (
 *     <a href="/login">Sign in</a>
 *   );
 * }
 * ```
 */
export async function getSession(options: GetSessionOptions = {}): Promise<ClientAuthResult> {
  if (typeof window === "undefined") {
    throw new Error(
      "[zitadel] getSession() reads the session from the browser. " +
        "In Server Components and Route Handlers use auth() from @zitadel/sdk-next/server " +
        "(requires the route to be covered by the middleware matcher).",
    );
  }

  const projectId = options.projectId || getZitadelConfig()?.projectId || publicProjectId();
  if (!projectId) {
    warnMissingProject();
    return { isAuthenticated: false, session: null };
  }
  return readSession({ proxyPath: options.proxyPath, projectId });
}

export type { ClientAuthResult, ClientAuthState, ClientSession } from "./types.js";
