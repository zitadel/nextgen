import { getZitadelConfig } from "@zitadel/api/config";
import { readSessionAnswer } from "@zitadel/sdk-core/middleware";

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
 * Fetches the same-origin `{proxyPath}/sessions/me` with credentials and
 * `cache: "no-store"` — the same read the `<zitadel-session>` card performs —
 * so the answer is the server's, not a client-side guess. Works on any page:
 * unlike server-side `auth()`, it does not require the route to be covered by
 * the middleware `matcher` (only the proxy path itself must be matched, which
 * the scaffolded request boundary always does), and it does not require
 * `configureZitadel()` to have run.
 *
 * The answer is read by the same rule the server SDKs apply
 * (`readSessionAnswer` from `@zitadel/sdk-core/middleware`):
 *
 * - A session (a `200` naming a non-empty `session_id`) with a user →
 *   `{ isAuthenticated: true, session }` with the client-safe identity
 *   (`userId`, `identifier`, `identifierProperty`, `display` — no token).
 * - An anonymous session, a `401` carrying the backend's `auth.unauthorized`
 *   code, or a `404` carrying `sess.not_found` → signed out. The code alone
 *   decides.
 * - Anything else throws — a `200` that is not a session (`{}` from a
 *   misrouted proxy), a framework's HTML 404 page, a `5xx`: a failing proxy is
 *   a misconfiguration and must not silently render as "signed out". Treat a
 *   rejection as "unknown" — distinct from signed-out — as the example does.
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
 *     getSession().then(setAuth, () => setFailed(true));
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

  // Strip trailing slashes so "/__nextgen/" doesn't produce a double-slash
  // URL that misses the request-boundary matcher — same normalization the
  // typed API client applies to its base URL.
  let proxyPath = options.proxyPath ?? getZitadelConfig()?.proxyPath ?? DEFAULT_PROXY_PATH;
  while (proxyPath.endsWith("/")) {
    proxyPath = proxyPath.slice(0, -1);
  }

  const response = await fetch(`${proxyPath}/sessions/me`, {
    cache: "no-store",
    credentials: "include",
    headers: { accept: "application/json" },
  });

  const answer = await readSessionAnswer(response);
  if (answer.status === "unknown") {
    throw new Error(`[nextgen] Session read failed: ${answer.why} from ${proxyPath}/sessions/me`);
  }
  // A dead session, or an anonymous one (no verified user factor yet), is
  // "not signed in" for app chrome.
  if (answer.status === "dead" || answer.session.userId === null) {
    return { isAuthenticated: false, session: null };
  }

  return {
    isAuthenticated: true,
    session: {
      userId: answer.session.userId,
      identifier: answer.session.identifier,
      identifierProperty: answer.session.identifierProperty,
      display: answer.session.display,
    },
  };
}

export type { ClientAuthResult, ClientAuthState, ClientSession } from "./types.js";
