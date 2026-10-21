import type { ReactiveController, ReactiveControllerHost } from "lit";

import { getSession, revokeSession } from "./api-client.js";
import type { resolveApi } from "./resolve-api.js";
import { emit } from "../internal/emit.js";

type Resolved = ReturnType<typeof resolveApi>;

/**
 * The signed-in identity and the sign-out call shared by `<zitadel-session>`
 * and `<zitadel-logout>`: one `GET /sessions/me` once a project is resolvable,
 * and `DELETE /sessions/me` that fires `zitadel-signout` on success.
 *
 * @fires {CustomEvent<ZitadelSignoutDetail>} zitadel-signout - The session was revoked; carries the display and identifier.
 */
export class SessionController implements ReactiveController {
  display = "";

  identifier = "";

  userId = "";

  loading = false;

  errorMessage = "";

  // One-shot guard: the fetch runs once config is resolvable, at connect time
  // or after a framework assigns `project` post-mount.
  private identityRequested = false;

  /**
   * @param resolve Returns the host's project and API handle, throwing while no
   *   project is resolvable.
   * @param onIdentitySettled Runs after the identity fetch resolves or fails.
   */
  private readonly host: ReactiveControllerHost & HTMLElement;
  private readonly resolve: () => Resolved;
  private readonly onIdentitySettled?: () => void;

  constructor(
    host: ReactiveControllerHost & HTMLElement,
    resolve: () => Resolved,
    onIdentitySettled?: () => void,
  ) {
    this.host = host;
    this.resolve = resolve;
    this.onIdentitySettled = onIdentitySettled;
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
   * Revokes the session in the host's project with credentials; the server
   * clears the cookie. Fires `zitadel-signout` (after `onRevoked`) and resolves
   * `true` on success; on failure sets `errorMessage` and resolves `false`.
   * The revoke is sent whatever the identity read found, since the cookie may
   * have changed since: a session that is already gone, or one of another
   * project that the server refuses to revoke, leaves nobody signed in here, so
   * sign-out completes and the other project's session stays.
   */
  async signOut(onRevoked?: () => void): Promise<boolean> {
    this.loading = true;
    this.errorMessage = "";
    this.host.requestUpdate();

    try {
      const { api, project } = this.resolve();
      await revokeSession(api, project.projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      this.errorMessage = message || "Sign-out failed. Please try again.";
      this.loading = false;
      this.host.requestUpdate();
      return false;
    }

    this.loading = false;
    this.host.requestUpdate();
    onRevoked?.();
    await emit(
      this.host,
      "zitadel-signout",
      { display: this.display, identifier: this.identifier },
      { waitForListeners: true },
    );
    return true;
  }

  private maybeLoadIdentity(): void {
    if (this.identityRequested) return;
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
    try {
      const session = await getSession(api, project.projectId);
      // A live session of another project: nobody to show here.
      if (session === null) return;
      this.display = session.user?.display ?? "";
      this.identifier = session.user?.identifier ?? "";
      this.userId = session.user_id ?? "";
      this.host.requestUpdate();
    } catch {
      // No active session, or not configured: render without an identity.
    } finally {
      this.onIdentitySettled?.();
    }
  }
}
