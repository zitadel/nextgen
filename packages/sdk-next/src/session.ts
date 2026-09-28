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
 * Fetches the same-origin `{proxyPath}/sessions/me` with credentials and
 * `cache: "no-store"` — the same read the `<zitadel-session>` card performs —
 * so the answer is the server's, not a client-side guess. Works on any page:
 * unlike server-side `auth()`, it does not require the route to be covered by
 * the middleware `matcher` (only the proxy path itself must be matched, which
 * the scaffolded request boundary always does), and it does not require
 * `configureZitadel()` to have run.
 *
 * - `200` with an authenticated user → `{ isAuthenticated: true, session }`
 *   with the client-safe identity (`userId`, `email`, `name` — no token).
 * - `200` for an anonymous session, `401` with `auth.unauthorized`, or `404`
 *   with `sess.not_found` → signed out.
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

  // Only the backend's canonical error envelope is definitive signed-out.
  // A framework route, gateway, or WAF can also return 401/404; accepting the
  // status or content type alone would turn a broken proxy into signed-out.
  if (response.status === 401 || response.status === 404) {
    const error = await readErrorEnvelope(response);
    const isSignedOut =
      (response.status === 401 && error?.code === "auth.unauthorized") ||
      (response.status === 404 && error?.code === "sess.not_found");
    if (isSignedOut) {
      return { isAuthenticated: false, session: null };
    }
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
      identifier: session.user?.identifier ?? null,
      identifierProperty: session.user?.identifier_property ?? null,
      display: session.user?.display ?? null,
    },
  };
}

export type { ClientAuthResult, ClientAuthState, ClientSession } from "./types.js";

type ErrorEnvelope = { code: string; message: string };

async function readErrorEnvelope(response: Response): Promise<ErrorEnvelope | undefined> {
  try {
    const body = (await response.json()) as unknown;
    if (
      typeof body === "object" &&
      body !== null &&
      "code" in body &&
      typeof body.code === "string" &&
      "message" in body &&
      typeof body.message === "string"
    ) {
      return { code: body.code, message: body.message };
    }
  } catch {
    // The caller reports the HTTP failure below; parsing details are untrusted.
  }
  return undefined;
}
