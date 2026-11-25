import type { GetMySession200 } from "@zitadel/api/generated/model";

import { getZitadelConfig } from "@zitadel/api/config";
import { API_PREFIX, apiBaseUrl } from "@zitadel/api/runtime/base-url";

import type { ClientAuthResult } from "./middleware.js";

/** Matches the `configureZitadel()` default so zero-config apps agree with the scaffold. */
const DEFAULT_PROXY_PATH = "/__nextgen";

const signedOut: ClientAuthResult = { isAuthenticated: false, session: null };

/** Options for {@link getSession}. */
export type GetSessionOptions = {
  /**
   * Same-origin path the app proxies to the Zitadel backend. Defaults to the
   * path from `configureZitadel()` when it has run on this page, else
   * `"/__nextgen"`.
   */
  proxyPath?: string;

  /**
   * The project this app signs its users in to. A session of another project
   * reads as signed out. Defaults to the project from `configureZitadel()`
   * when it has run on this page. With none, nobody reads as signed in.
   */
  projectId?: string;
};

let warnedMissingProject = false;

/** Says once per page why `getSession()` signs no one in: no project is known. */
function warnMissingProject(): void {
  if (warnedMissingProject) {
    return;
  }
  warnedMissingProject = true;
  console.warn(
    "[nextgen] getSession(): no project id is known, so no session counts as signed in. " +
      "Pass `projectId` or call configureZitadel() first.",
  );
}

/**
 * Reads the current session state from the browser: the way an app's own UI
 * (header navigation, account menus, route guards) learns whether a user is
 * signed in and who they are.
 *
 * Fetches the same-origin `{proxyPath}/api/v1/sessions/me?project_id=…` with
 * credentials and `cache: "no-store"`, the same read the `<zitadel-session>`
 * card performs, so the answer is the server's, not a client-side guess.
 *
 * - `200` with an authenticated user of the project → `{ isAuthenticated: true, session }`
 *   with the client-safe identity (`userId`, `identifier`,
 *   `identifierProperty`, `display`; no token).
 * - `200` for an anonymous session, `401` with `auth.unauthorized`, `403`
 *   with `sess.project_mismatch`, or `404` with `sess.not_found` → signed out.
 *   The `403` answers a session of another project on the same server, and a
 *   `200` naming another project (from a server that predates the parameter)
 *   reads as signed out too.
 * - Any other response throws, including a framework's HTML 404 page from a
 *   misrouted proxy: a failing proxy is a misconfiguration and must not
 *   silently render as "signed out". Treat a rejection as "unknown", distinct
 *   from signed out.
 */
export async function getSession(options: GetSessionOptions = {}): Promise<ClientAuthResult> {
  if (typeof window === "undefined") {
    throw new Error(
      "[nextgen] getSession() reads the session from the browser; on a server, " +
        "use your framework SDK's server-side session helper.",
    );
  }

  // The base the typed API client uses: trailing slashes go, so "/__nextgen/"
  // doesn't produce a double-slash URL that misses a proxy rule, and the API
  // prefix follows.
  const endpoint = `${apiBaseUrl(
    options.proxyPath ?? getZitadelConfig()?.proxyPath ?? DEFAULT_PROXY_PATH,
  )}/sessions/me`;
  const projectId = options.projectId || getZitadelConfig()?.projectId;
  if (!projectId) {
    warnMissingProject();
    return signedOut;
  }

  const response = await fetch(`${endpoint}?project_id=${encodeURIComponent(projectId)}`, {
    cache: "no-store",
    credentials: "include",
    headers: { accept: "application/json" },
  });

  // Only the backend's canonical error envelope is definitive signed-out.
  // A framework route, gateway, or WAF can also return 401/404; accepting the
  // status or content type alone would turn a broken proxy into signed-out.
  let code: string | undefined;
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    const error = await readErrorEnvelope(response);
    code = error?.code;
    const isSignedOut =
      (response.status === 401 && error?.code === "auth.unauthorized") ||
      (response.status === 403 && error?.code === "sess.project_mismatch") ||
      (response.status === 404 && error?.code === "sess.not_found");
    if (isSignedOut) {
      return signedOut;
    }
  }

  if (!response.ok) {
    // `req.not_found` is the server knowing no such operation: it is older
    // than this SDK and does not serve the API under its prefix.
    const cause =
      code === "req.not_found"
        ? ` (req.not_found: a server older than this SDK does not serve the API under ${API_PREFIX})`
        : "";
    throw new Error(
      `[nextgen] Session read failed: HTTP ${response.status} from ${endpoint}${cause}`,
    );
  }

  const session = (await response.json()) as GetMySession200;

  // An anonymous session (no verified user factor yet) has no user_id, and a
  // backend that predates `project_id` answers for any project: for app
  // chrome, either is "not signed in".
  if (!session.user_id || session.project_id !== projectId) {
    return signedOut;
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

export type { ClientAuthResult, ClientAuthState, ClientSession } from "./middleware.js";

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
