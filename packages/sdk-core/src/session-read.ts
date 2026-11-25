import type { GetMySession200 } from "@zitadel/api/generated/model";

import { getZitadelConfig } from "@zitadel/api/config";
import { API_PREFIX, apiBaseUrl } from "@zitadel/api/runtime/base-url";

import type { ClientAuthResult } from "./middleware.js";

/**
 * The proxy path used when neither the options nor `configureZitadel` name one.
 *
 * It matches the default of `configureZitadel`, so an app without configuration agrees with the
 * scaffold that `zitadel setup` writes.
 */
const DEFAULT_PROXY_PATH = "/__nextgen";

/**
 * The shared signed-out result.
 */
const signedOut: ClientAuthResult = { isAuthenticated: false, session: null };

/**
 * The options of {@link getSession}.
 *
 * Both properties fall back to what `configureZitadel` configured on the page, so a call without
 * options works in an app that configured the SDK once.
 *
 * @example
 * ```ts
 * const options: GetSessionOptions = { projectId: "296547382910273", proxyPath: "/__nextgen" };
 * ```
 */
export type GetSessionOptions = {
  /**
   * The same-origin proxy path that the app forwards to the auth backend.
   *
   * The read goes to the proxy and not to the backend directly, so the session cookie stays
   * first-party and no CORS setup is needed. Trailing slashes are removed. Change it only when the
   * proxy is mounted elsewhere.
   *
   * @defaultValue The path from `configureZitadel` when it has run on this page, else "/__nextgen".
   */
  proxyPath?: string;

  /**
   * The project id that the app signs its users in to.
   *
   * A session of another project reads as signed out, so an app and the Console on one host do not
   * see each other's sessions. With no project id at all, nobody reads as signed in and the read
   * logs one warning per page: a missing id is a misconfiguration and must not look like a
   * signed-in state.
   *
   * @defaultValue The project id from `configureZitadel` when it has run on this page.
   */
  projectId?: string;
};

/**
 * Whether the missing-project warning has been logged on this page.
 */
let warnedMissingProject = false;

/**
 * Logs once per page why {@link getSession} signs no one in: no project id is known.
 */
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
 * Reads the current session state from the browser.
 *
 * It is how the own UI of an app, such as header navigation, an account menu or a route guard,
 * learns whether a user is signed in and who they are. It fetches the same-origin
 * `{proxyPath}/api/v1/sessions/me?project_id=...` with credentials and `cache: "no-store"`. That is
 * the read that the `<zitadel-session>` widget performs, so the answer is the server's and not a
 * guess made on the client. The result never carries the session token: the token is an
 * `HttpOnly` cookie that client JavaScript cannot read, and it must not reach client code through
 * a server-rendered payload or a fetch result.
 *
 * Reading the answer:
 *
 * - A `200` with an authenticated user of the project gives `{ isAuthenticated: true, session }`
 *   with the client-safe identity: `userId`, `identifier`, `identifierProperty` and `display`.
 * - A `200` for an anonymous session, a `401` with `auth.unauthorized`, a `403` with
 *   `sess.project_mismatch` and a `404` with `sess.not_found` all give signed out. The `403`
 *   answers a session of another project on the same server, and a `200` that names another
 *   project, from a server that predates the parameter, reads as signed out too.
 * - Any other response throws, including the HTML 404 page of a framework that a misrouted proxy
 *   returns, and a `404` with `req.not_found`, which means the server is older than the SDK. A
 *   failing proxy is a misconfiguration and must not render as signed out.
 *
 * Treat a rejection as unknown, which is different from signed out: keep the last known state and
 * show an error, and do not redirect to the sign-in page.
 *
 * It runs in the browser only. On a server it throws, because the cookie is not available there;
 * use the server-side session helper of the framework SDK instead. For a reactive read that
 * several components share, use {@link sessionStore}.
 *
 * @param options - The proxy path and project id; both fall back to `configureZitadel`.
 * @returns The signed-in session without the token, or the signed-out state.
 * @throws {Error} When called on a server, or when the proxy answers something other than a
 * session or a signed-out answer.
 *
 * @example
 * ```ts
 * import { getSession } from "@zitadel/sdk-core/session";
 *
 * const auth = await getSession({ projectId: "296547382910273" });
 * if (auth.isAuthenticated) {
 *   console.log(auth.session.display ?? auth.session.identifier ?? auth.session.userId);
 * }
 * ```
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

/**
 * The error body that the backend answers with: a stable code and a message.
 */
type ErrorEnvelope = { code: string; message: string };

/**
 * Reads the error envelope of a response, if it has one.
 *
 * @param response - The response to read.
 * @returns The envelope, or `undefined` when the body is not one.
 */
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
