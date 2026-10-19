import type { ReactiveController, ReactiveControllerHost } from "lit";

import { ApiError, apiErrorCode } from "@zitadel/api/runtime/fetch";

import { getSession, revokeSession, type SessionIdentity } from "./api-client.js";
import type { resolveApi } from "./resolve-api.js";
import { emit } from "../internal/emit.js";

type Resolved = ReturnType<typeof resolveApi>;

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

/**
 * A request that answered 200 with something the backend would not send: not a
 * session for `GET /sessions/me`, a body for `DELETE /sessions/me`. A response
 * did come back, so the event carries its status.
 */
class UnexpectedAnswerError extends Error {
  readonly status = 200;
}

function sessionErrorDetail(
  error: unknown,
  message: string,
  phase: SessionErrorDetail["phase"],
): SessionErrorDetail {
  if (error instanceof UnexpectedAnswerError) return { status: error.status, message, phase };
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
  /**
   * Runs, after `zitadel-signout`, once a host that was removed while its
   * sign-out succeeded is put back: the navigation `signOut()` held back
   * because a full-page load would have unloaded the host before it could
   * report.
   */
  readonly onSignedOutWhileDetached?: () => void;
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

  // A sign-out failure that settled while the host was detached: it could not
  // reach the page's listeners, so it is reported once the host is back.
  private missedSignOutFailure: SessionErrorDetail | undefined;

  // A sign-out that succeeded while the host was detached: its `zitadel-signout`
  // had no page to reach, so it is fired once the host is back.
  private missedSignOut: { display: string; identifier: string } | undefined;

  // The "no session" answer settled while the host was detached: it must not
  // act for the page then (the redirect would leave a page the card is not on),
  // so it is replayed once the host is back.
  private missedSessionMissing = false;

  // The cookie holds a live session of another project: not this app's to
  // revoke. On a shared host (localhost) it is, for example, the Console's.
  private otherProjectSession = false;

  private readonly host: ReactiveControllerHost & HTMLElement;
  private readonly resolve: () => Resolved;
  private readonly options: SessionControllerOptions;

  /**
   * @param resolve Returns the host's project and API handle, throwing while no
   *   project is resolvable.
   */
  constructor(
    host: ReactiveControllerHost & HTMLElement,
    resolve: () => Resolved,
    options: SessionControllerOptions = {},
  ) {
    this.host = host;
    this.resolve = resolve;
    this.options = options;
    host.addController(this);
  }

  hostConnected(): void {
    const signedOut = this.missedSignOut;
    if (signedOut) {
      this.missedSignOut = undefined;
      emit(this.host, "zitadel-signout", signedOut);
      this.options.onSignedOutWhileDetached?.();
    }
    const missed = this.missedSignOutFailure;
    if (missed) {
      this.missedSignOutFailure = undefined;
      emit(this.host, "zitadel-session-error", missed);
    }
    if (this.missedSessionMissing) {
      this.missedSessionMissing = false;
      this.options.onSessionMissing?.();
    }
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
   * `zitadel-signout` (after `onRevoked`) and resolves `true` on success; a host
   * removed meanwhile resolves `false` and fires it once put back. The
   * backend answering that there is no session (see {@link isNoSession}) means
   * it is already gone, which is what signing out asks for, so it succeeds the
   * same way. Any other failure, a gateway's 401 or 404 included, revoked
   * nothing: it sets `errorMessage`, fires `zitadel-session-error` and
   * resolves `false`. When the identity read found a session of another
   * project, nobody is signed in here: that session is left alone and sign-out
   * completes without a revoke.
   */
  async signOut(onRevoked?: () => void): Promise<boolean> {
    this.loading = true;
    this.errorMessage = "";
    this.host.requestUpdate();

    try {
      if (!this.otherProjectSession) {
        const answer = await revokeSession(this.resolve().api);
        // The backend answers `204` with no body. Anything else (an SPA host's
        // page, a proxy's `{}`) did not come from the backend, so nothing was revoked.
        if (answer !== undefined) {
          throw new UnexpectedAnswerError("Could not sign out: the response is not the backend's.");
        }
      }
    } catch (error) {
      if (!isNoSession(error)) {
        const message = error instanceof Error ? error.message : "";
        this.errorMessage = message || "Sign-out failed. Please try again.";
        this.loading = false;
        this.host.requestUpdate();
        const failure = sessionErrorDetail(error, this.errorMessage, "signout");
        if (this.host.isConnected) {
          emit(this.host, "zitadel-session-error", failure);
        } else {
          // Removed while the request was in flight: the host no longer speaks
          // for the page, so it reports this when it is put back.
          this.missedSignOutFailure = failure;
        }
        return false;
      }
    }

    this.loading = false;
    this.host.requestUpdate();
    onRevoked?.();
    const detail = { display: this.display, identifier: this.identifier };
    // Removed while the request was in flight: the session is gone all the same,
    // and the page hears of it when the host is put back.
    if (this.host.isConnected) {
      emit(this.host, "zitadel-signout", detail);
      return true;
    }
    // Resolves `false` so the caller does not navigate yet: `hostConnected`
    // reports, then runs `onSignedOutWhileDetached`.
    this.missedSignOut = detail;
    return false;
  }

  private maybeLoadIdentity(): void {
    if (this.identityRequested) return;
    // A detached host loads when it is connected again (`hostConnected`), not
    // from an update it receives meanwhile.
    if (!this.host.isConnected) return;
    let resolved: Resolved;
    try {
      resolved = this.resolve();
    } catch {
      return;
    }
    this.identityRequested = true;
    void this.loadIdentity(resolved);
  }

  private async loadIdentity({ api, project }: Resolved): Promise<void> {
    let missing: boolean;
    let failure: SessionErrorDetail | undefined;
    try {
      const session = (await getSession(api, project.projectId)) as Partial<SessionIdentity> | null;
      if (session === null) {
        // A live session of another project: not this app's to show or revoke,
        // and not an answer that nobody is signed in, so the surface stays.
        this.otherProjectSession = true;
        missing = false;
      } else {
        // A 200 without the session JSON's non-empty `session_id` (an SPA host's
        // `index.html` served for an unrewritten proxy path, a proxy's `{}`, an empty
        // id) did not come from the backend. The server SDKs reject the same bodies.
        if (typeof session?.session_id !== "string" || session.session_id === "") {
          throw new UnexpectedAnswerError(
            "Could not load the session: the response is not a session.",
          );
        }
        this.display = session.user?.display ?? "";
        this.identifier = session.user?.identifier ?? "";
        this.userId = session.user_id ?? "";
        missing = !this.userId;
        this.state = missing ? "signed-out" : "signed-in";
      }
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
        // that answer instead, and the failure it discards must not outlive a
        // retry that succeeds.
        this.identityRequested = false;
        // A sign-out failure that is waiting to be reported keeps its message.
        if (this.missedSignOutFailure === undefined) {
          this.errorMessage = "";
        }
      }
    }
    if (missing) this.notifyMissing();
  }

  private notifyMissing(): void {
    if (this.host.isConnected) this.options.onSessionMissing?.();
    else this.missedSessionMissing = true;
  }
}
