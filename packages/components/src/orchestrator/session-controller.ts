import type { ReactiveController, ReactiveControllerHost } from "lit";

import { ApiError, apiErrorCode } from "@zitadel/api/runtime/fetch";

import { getSession, revokeSession, type SessionIdentity } from "./api-client.js";
import type { resolveApi } from "./resolve-api.js";
import { emit } from "../internal/emit.js";

type Api = ReturnType<typeof resolveApi>["api"];

/**
 * What the host knows about the visitor's session:
 *
 * - `unknown` until the identity request settles, while no project is
 *   configured, or when the request failed without the backend answering (see
 *   {@link isNoSession}): the session may well be fine, so the host keeps its
 *   surface and shows the error;
 * - `signed-in` once `GET /sessions/me` named a user;
 * - `signed-out` when the backend answered that there is no session, or named
 *   no user.
 */
export type SessionState = "unknown" | "signed-in" | "signed-out";

/**
 * The backend itself answered that the request carries no live session: a
 * `401` with its `auth.unauthorized` code (a missing, invalid, expired or
 * revoked cookie) or a `404` with `sess.not_found`. A gateway, a WAF, an
 * ingress default backend or a wrong base path answers 401 and 404 too, but
 * without the backend's code. That says nothing about the session, so it is an
 * error like a 5xx. The server SDKs decide a session check the same way.
 */
function isNoSession(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  const code = apiErrorCode(error);
  return (
    (error.status === 401 && code === "auth.unauthorized") ||
    (error.status === 404 && code === "sess.not_found")
  );
}

/**
 * Whether a `GET /sessions/me` 200 carries the session JSON, which always has
 * a non-empty `session_id`. Anything else (an SPA host's `index.html` served
 * for an unrewritten proxy path, a proxy's `{}`, an empty id) did not come
 * from the backend. The server SDKs reject the same bodies.
 */
function isSessionBody(body: unknown): body is SessionIdentity {
  if (typeof body !== "object" || body === null) return false;
  const id = (body as { session_id?: unknown }).session_id;
  return typeof id === "string" && id !== "";
}

/**
 * Payload of `zitadel-session-error`: which request failed (`load` for the
 * identity, `signout` for the revoke), the message the widget shows, and, when
 * a response came back, its status and the backend's error code.
 */
export interface SessionErrorDetail {
  readonly status?: number;
  readonly code?: string;
  readonly message: string;
  readonly phase: "load" | "signout";
}

function sessionErrorDetail(
  error: unknown,
  message: string,
  phase: SessionErrorDetail["phase"],
): SessionErrorDetail {
  if (!(error instanceof ApiError)) return { message, phase };
  const code = apiErrorCode(error);
  return code === undefined
    ? { status: error.status, message, phase }
    : { status: error.status, code, message, phase };
}

export interface SessionControllerOptions {
  /** Runs after the identity fetch resolves or fails. */
  readonly onIdentitySettled?: () => void;
  /** Runs when the identity request finds that the visitor has no session. */
  readonly onSessionMissing?: () => void;
}

/**
 * The signed-in identity and the sign-out call shared by `<zitadel-session>`
 * and `<zitadel-logout>`: one `GET /sessions/me` once a project is resolvable,
 * and `DELETE /sessions/me` that fires `zitadel-signout` on success. A visitor
 * the backend says has no session is `signed-out`, so the host can stop
 * offering a sign-out to nobody. Any other failure of either request (a 5xx, a
 * network error, a gateway's page, a 200 that is not a session) keeps the
 * host's surface, sets `errorMessage` and fires `zitadel-session-error`, so the
 * app can tell an outage from a visitor without a session.
 */
export class SessionController implements ReactiveController {
  display = "";

  identifier = "";

  userId = "";

  loading = false;

  errorMessage = "";

  state: SessionState = "unknown";

  // One-shot guard: the fetch runs once config is resolvable, at connect time
  // or after a framework assigns `project` post-mount.
  private identityRequested = false;

  private readonly host: ReactiveControllerHost & HTMLElement;
  private readonly resolve: () => Api;
  private readonly options: SessionControllerOptions;

  /**
   * @param resolve Returns the host's API handle, throwing while no project is
   *   resolvable.
   */
  constructor(
    host: ReactiveControllerHost & HTMLElement,
    resolve: () => Api,
    options: SessionControllerOptions = {},
  ) {
    this.host = host;
    this.resolve = resolve;
    this.options = options;
    host.addController(this);
  }

  hostConnected(): void {
    this.maybeLoadIdentity();
  }

  hostUpdated(): void {
    this.maybeLoadIdentity();
  }

  /** Single identity line: human-readable name, then identifier, then user id. */
  get label(): string {
    return this.display || this.identifier || this.userId;
  }

  clearError(): void {
    this.errorMessage = "";
    this.host.requestUpdate();
  }

  /**
   * Revokes the session with credentials; the server clears the cookie. Fires
   * `zitadel-signout` (after `onRevoked`) and resolves `true` on success. The
   * backend answering that there is no session (see {@link isNoSession}) means
   * it is already gone, which is what signing out asks for, so it succeeds the
   * same way. Any other failure, a gateway's 401 or 404 included, revoked
   * nothing: it sets `errorMessage`, fires `zitadel-session-error` and
   * resolves `false`.
   */
  async signOut(onRevoked?: () => void): Promise<boolean> {
    this.loading = true;
    this.errorMessage = "";
    this.host.requestUpdate();

    try {
      await revokeSession(this.resolve());
    } catch (error) {
      if (!isNoSession(error)) {
        const message = error instanceof Error ? error.message : "";
        this.errorMessage = message || "Sign-out failed. Please try again.";
        this.loading = false;
        this.host.requestUpdate();
        emit(
          this.host,
          "zitadel-session-error",
          sessionErrorDetail(error, this.errorMessage, "signout"),
        );
        return false;
      }
    }

    this.loading = false;
    this.host.requestUpdate();
    onRevoked?.();
    emit(this.host, "zitadel-signout", { display: this.display, identifier: this.identifier });
    return true;
  }

  private maybeLoadIdentity(): void {
    if (this.identityRequested) return;
    // A detached host loads when it is connected again (`hostConnected`), not
    // from an update it receives meanwhile.
    if (!this.host.isConnected) return;
    let api: Api;
    try {
      api = this.resolve();
    } catch {
      return;
    }
    this.identityRequested = true;
    void this.loadIdentity(api);
  }

  private async loadIdentity(api: Api): Promise<void> {
    let missing: boolean;
    let failure: SessionErrorDetail | undefined;
    try {
      const session: unknown = await getSession(api);
      if (!isSessionBody(session)) {
        throw new Error("Could not load the session: the response is not a session.");
      }
      this.display = session.user?.display ?? "";
      this.identifier = session.user?.identifier ?? "";
      this.userId = session.user_id ?? "";
      missing = !this.userId;
      this.state = missing ? "signed-out" : "signed-in";
    } catch (error) {
      missing = isNoSession(error);
      if (missing) {
        this.state = "signed-out";
      } else {
        // An outage, not an answer: keep the surface and say what went wrong.
        const message = error instanceof Error ? error.message : "";
        this.errorMessage = message || "Could not load the session. Please try again.";
        failure = sessionErrorDetail(error, this.errorMessage, "load");
      }
    }
    this.host.requestUpdate();
    this.options.onIdentitySettled?.();
    if (failure) {
      if (this.host.isConnected) {
        emit(this.host, "zitadel-session-error", failure);
      } else {
        // A host removed while the request was in flight reports nothing: it
        // no longer speaks for the page. Put back, it asks again and reports
        // that answer instead.
        this.identityRequested = false;
      }
    }
    if (missing && this.host.isConnected) this.options.onSessionMissing?.();
  }
}
