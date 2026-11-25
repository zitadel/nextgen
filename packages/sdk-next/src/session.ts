import { getZitadelConfig } from "@zitadel/api/config";
import { getSession as readSession } from "@zitadel/sdk-core/session";

import type { ClientAuthResult } from "./types.js";

/** Options for {@link getSession}. */
export type GetSessionOptions = {
  /**
   * Proxy path the scaffolded request boundary forwards to the Zitadel
   * backend. Defaults to the path from `configureZitadel()` when it has run
   * on this page, else `"/__nextgen"` (the scaffold default).
   */
  proxyPath?: string;

  /**
   * The project this app signs its users in to. A session of another project
   * reads as signed out. Defaults to the project from `configureZitadel()`
   * when it has run on this page, else `NEXT_PUBLIC_ZITADEL_PROJECT_ID`. With
   * none, nobody reads as signed in, as on the server.
   */
  projectId?: string;
};

/**
 * `NEXT_PUBLIC_ZITADEL_PROJECT_ID`, which Next.js inlines into client bundles
 * at build time. Read defensively: where it was not inlined, `process` may not
 * exist in the browser.
 */
function publicProjectId(): string | undefined {
  try {
    return process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID || undefined;
  } catch {
    return undefined;
  }
}

let warnedMissingProject = false;

/** Says once per page why `getSession()` signs no one in: no project is known. */
function warnMissingProject(): void {
  if (warnedMissingProject) {
    return;
  }
  warnedMissingProject = true;
  console.warn(
    "[nextgen] getSession(): no project id is known, so no session counts as signed in. " +
      "Pass `projectId` (e.g. process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID) or call " +
      "configureZitadel() first.",
  );
}

/**
 * Reads the current session state from the browser — the supported way for
 * an app's own UI (header navigation, account menus) to know whether a user
 * is signed in and who they are.
 *
 * Fetches the same-origin `{proxyPath}/api/v1/sessions/me?project_id=…` with
 * credentials and `cache: "no-store"` — the same read the `<zitadel-session>`
 * card performs — so the answer is the server's, not a client-side guess.
 * Works on any page: unlike server-side `auth()`, it does not require the
 * route to be covered by the middleware `matcher` (only the proxy path itself
 * must be matched, which the scaffolded request boundary always does).
 *
 * A session counts only in the app's own project: `options.projectId`, else
 * the project of `configureZitadel()`, else `NEXT_PUBLIC_ZITADEL_PROJECT_ID`.
 * With none of them, it reads as signed out without asking the server.
 *
 * - `200` with an authenticated user → `{ isAuthenticated: true, session }`
 *   with the client-safe identity (`userId`, `identifier`,
 *   `identifierProperty`, `display` — no token).
 * - `200` for an anonymous session, `401` with `auth.unauthorized`, `403`
 *   with `sess.project_mismatch`, or `404` with `sess.not_found` → signed out.
 *   The `403` answers a session of another project on the same server, and a
 *   `200` naming another project (from a server that predates the parameter)
 *   reads as signed out too.
 * - Any other response throws — including a framework's HTML 404 page from
 *   a misrouted proxy: a failing proxy is a misconfiguration and must not
 *   silently render as "signed out". Treat a rejection as "unknown" —
 *   distinct from signed-out — as the example does.
 *
 * ```tsx
 * "use client";
 * import { getSession, type ClientAuthResult } from "@zitadel/sdk-next/session";
 *
 * export function HeaderNav() {
 *   // undefined = not yet known — render neutral chrome, not "Sign in".
 *   const [auth, setAuth] = useState<ClientAuthResult>();
 *   const [failed, setFailed] = useState(false);
 *   useEffect(() => {
 *     getSession({ projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID }).then(
 *       setAuth,
 *       () => setFailed(true),
 *     );
 *   }, []);
 *   if (failed) return <span role="alert">Session unavailable</span>;
 *   if (!auth) return null;
 *   return auth.isAuthenticated
 *     ? <a href="/profile">{auth.session.display ?? auth.session.identifier ?? "Account"}</a>
 *     : <a href="/login">Sign in</a>;
 * }
 * ```
 *
 * The transitions need no extra wiring in the scaffolded posture: sign-in
 * (`post-sign-in-url`) and sign-out (`post-sign-out-url`) both navigate, so
 * chrome re-reads on the next page load. To react in place instead, listen
 * for the widgets' `zitadel-signout` / `zitadel-flow-complete` events.
 *
 * @returns The current {@link ClientAuthResult}.
 */
export async function getSession(options: GetSessionOptions = {}): Promise<ClientAuthResult> {
  if (typeof window === "undefined") {
    throw new Error(
      "[nextgen] getSession() reads the session from the browser. " +
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
