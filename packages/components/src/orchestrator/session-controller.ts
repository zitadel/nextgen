import type { ReactiveController, ReactiveControllerHost } from "lit";

import { ApiError, apiErrorCode } from "@zitadel/api/runtime/fetch";

import { getSession, revokeSession, type SessionIdentity } from "./api-client.js";
import type { resolveApi } from "./resolve-api.js";
import { onConfigChange } from "../internal/config-change.js";
import { emit } from "../internal/emit.js";

type Resolved = ReturnType<typeof resolveApi>;
type Api = Resolved["api"];

/**
 * What the host knows about the visitor's session:
 *
 * - `unknown` until the identity request settles, while no project is
 *   configured, or when the request failed without the backend answering
 *   (see {@link isNoSession}): the session may well be fine, so the host keeps
 *   its surface and shows the error;
 * - `signed-in` once `GET /sessions/me` named a user;
 * - `signed-out` when the backend answered that there is no session, or named
 *   no user, or after a sign-out that stays on the page.
 */
export type SessionState = "unknown" | "signed-in" | "signed-out";

/** Identifies the session a resolved project points at, for refetch decisions. */
function projectKey({ project }: Resolved): string {
  return JSON.stringify([
    project.projectId,
    project.proxyPath,
    project.url ?? "",
    project.publishableKey ?? "",
  ]);
}

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
  /** Runs after the identity is fetched, fails to load, or is cleared. */
  readonly onIdentityChanged?: () => void;
  /**
   * Runs when the identity request finds no session, right after
   * `zitadel-session-missing` is dispatched.
   */
  readonly onSessionMissing?: () => void;
}

/**
 * The signed-in identity and the sign-out call shared by `<zitadel-session>`
 * and `<zitadel-logout>`: `GET /sessions/me` for the resolved project (again
 * whenever that project changes), and `DELETE /sessions/me` that fires
 * `zitadel-signout` on success. A visitor without a session gets
 * `zitadel-session-missing` instead, so the host can stop offering a sign-out
 * to nobody. Any other failure of either request (a 5xx, a network error, a
 * gateway's page, a 200 that is not a session) fires `zitadel-session-error`,
 * so the app can tell an outage from a visitor without a session.
 */
export class SessionController implements ReactiveController {
  display = "";

  identifier = "";

  userId = "";

  loading = false;

  errorMessage = "";

  state: SessionState = "unknown";

  // The project the shown identity belongs to. A host that swaps its
  // `project` (a tenant switch, or a placeholder handle replaced by the real
  // one) must not keep showing the old user while sign-out revokes the new
  // project's session.
  private loadedKey: string | undefined;

  // Bumped per fetch, and when the identity is cleared, so a slow response for
  // a project that has since been replaced, or for a session that has since
  // been revoked, cannot overwrite what the host shows now.
  private loadSeq = 0;

  private unsubscribeConfig: (() => void) | undefined;

  private readonly host: ReactiveControllerHost & HTMLElement;
  private readonly resolve: () => Resolved;
  private readonly options: SessionControllerOptions;

  /**
   * @param resolve Returns the host's project and API handle, throwing while
   *   no project is resolvable.
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
    // A `configureZitadel()` that runs after mount changes no property of the
    // host, so nothing else would trigger the fetch.
    this.unsubscribeConfig = onConfigChange(() => this.maybeLoadIdentity());
    this.maybeLoadIdentity();
  }

  hostDisconnected(): void {
    this.unsubscribeConfig?.();
    this.unsubscribeConfig = undefined;
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
   * Forgets the shown identity, for a host that stays on the page after
   * signing out: the revoked session no longer belongs to anyone. An identity
   * request still in flight is dropped, or its answer would bring the
   * signed-out user back.
   */
  clearIdentity(): void {
    this.loadSeq += 1;
    this.display = "";
    this.identifier = "";
    this.userId = "";
    this.state = "signed-out";
    this.host.requestUpdate();
    this.options.onIdentityChanged?.();
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
      await revokeSession(this.resolve().api);
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
    // A detached host loads when it is connected again (`hostConnected`), not
    // from an update it receives meanwhile.
    if (!this.host.isConnected) return;
    let resolved: Resolved;
    try {
      resolved = this.resolve();
    } catch {
      return;
    }
    const key = projectKey(resolved);
    if (key === this.loadedKey) return;
    const replacing = this.loadedKey !== undefined;
    this.loadedKey = key;
    if (replacing) {
      // Not rendered until the new fetch settles: requesting an update from
      // `hostUpdated` would schedule a change-in-update.
      this.display = "";
      this.identifier = "";
      this.userId = "";
      this.state = "unknown";
    }
    void this.loadIdentity(resolved.api, ++this.loadSeq);
  }

  private async loadIdentity(api: Api, seq: number): Promise<void> {
    let missing: boolean;
    let failure: SessionErrorDetail | undefined;
    try {
      const session: unknown = await getSession(api);
      if (seq !== this.loadSeq) return;
      if (!isSessionBody(session)) {
        throw new Error("Could not load the session: the response is not a session.");
      }
      this.display = session.user?.display ?? "";
      this.identifier = session.user?.identifier ?? "";
      this.userId = session.user_id ?? "";
      this.errorMessage = "";
      missing = !this.userId;
      this.state = missing ? "signed-out" : "signed-in";
    } catch (error) {
      if (seq !== this.loadSeq) return;
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
    this.options.onIdentityChanged?.();
    // A host removed while the request was in flight reports nothing: it no
    // longer speaks for the page.
    if (failure && this.host.isConnected) emit(this.host, "zitadel-session-error", failure);
    if (!missing) return;
    if (!this.host.isConnected) {
      // A host removed while the request was in flight no longer speaks for
      // the page, so it must not announce or navigate. Put back (a kept-alive
      // tab, a reparenting portal), it asks again and announces then.
      this.loadedKey = undefined;
      return;
    }
    emit(this.host, "zitadel-session-missing", {});
    this.options.onSessionMissing?.();
  }
}
