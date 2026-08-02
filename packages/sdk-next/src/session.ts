import type { GetMySession200 } from "@zitadel/api/generated/model";

import { getZitadelConfig } from "@zitadel/api/config";

import type { ClientAuthResult } from "./types.js";

/** Matches the `configureZitadel()` default so zero-config apps agree with the scaffold. */
const DEFAULT_PROXY_PATH = "/__nextgen";

/** Options for {@link getSession}. */
export type GetSessionOptions = {
  /**
   * Proxy path the scaffolded request boundary forwards to the Zitadel
   * backend. Defaults to the path from `configureZitadel()` when it has run
   * on this page, else `"/__nextgen"` (the scaffold default).
   */
  proxyPath?: string;
};

/**
 * Reads the current session state from the browser — the supported way for
 * an app's own UI (header navigation, account menus) to know whether a user
 * is signed in and who they are.
 *
 * Fetches the same-origin `{proxyPath}/sessions/me` with credentials — the
 * same read the `<zitadel-session>` card performs — so the answer is the
 * server's, not a client-side guess. Works on any page: unlike server-side
 * `auth()`, it does not require the route to be covered by the middleware
 * `matcher` (only the proxy path itself must be matched, which the
 * scaffolded request boundary always does), and it does not require
 * `configureZitadel()` to have run.
 *
 * - `200` with an authenticated user → `{ isAuthenticated: true, session }`
 *   with the client-safe identity (`userId`, `email`, `name` — no token).
 * - `200` for an anonymous session, `401`, or `404` → signed out.
 * - Any other response throws: a failing proxy is a misconfiguration and
 *   must not silently render as "signed out". Chrome that prefers a quiet
 *   fallback can `.catch()` to its signed-out state.
 *
 * ```tsx
 * "use client";
 * import { getSession, type ClientAuthResult } from "@zitadel/sdk-next/session";
 *
 * const signedOut: ClientAuthResult = { isAuthenticated: false, session: null };
 *
 * export function HeaderNav() {
 *   const [auth, setAuth] = useState<ClientAuthResult>(signedOut);
 *   useEffect(() => {
 *     getSession().then(setAuth, () => setAuth(signedOut));
 *   }, []);
 *   return auth.isAuthenticated
 *     ? <a href="/profile">{auth.session.name ?? auth.session.email ?? "Account"}</a>
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

  const proxyPath = options.proxyPath ?? getZitadelConfig()?.proxyPath ?? DEFAULT_PROXY_PATH;
  const response = await fetch(`${proxyPath}/sessions/me`, {
    credentials: "include",
    headers: { accept: "application/json" },
  });

  // 401 = no/invalid session token, 404 = session gone (revoked/expired):
  // both are the server's definitive "not signed in".
  if (response.status === 401 || response.status === 404) {
    return { isAuthenticated: false, session: null };
  }

  if (!response.ok) {
    throw new Error(
      `[nextgen] Session read failed: HTTP ${response.status} from ${proxyPath}/sessions/me`,
    );
  }

  const session = (await response.json()) as GetMySession200;

  // An anonymous session (no verified user factor yet) has no user_id —
  // for app chrome that is "not signed in".
  if (!session.user_id) {
    return { isAuthenticated: false, session: null };
  }

  return {
    isAuthenticated: true,
    session: {
      userId: session.user_id,
      email: session.email ?? null,
      name: session.name ?? null,
    },
  };
}

export type { ClientAuthResult, ClientAuthState, ClientSession } from "./types.js";
