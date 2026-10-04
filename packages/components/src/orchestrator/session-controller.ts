import type { ReactiveController, ReactiveControllerHost } from "lit";

import { getSession, revokeSession } from "./api-client.js";
import type { resolveApi } from "./resolve-api.js";
import { emit } from "../internal/emit.js";

type Api = ReturnType<typeof resolveApi>["api"];

/**
 * The signed-in identity and the sign-out call shared by `<zitadel-session>`
 * and `<zitadel-logout>`: one `GET /sessions/me` once a project is resolvable,
 * and `DELETE /sessions/me` that fires `zitadel-signout` on success.
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
   * @param resolve Returns the host's API handle, throwing while no project is
   *   resolvable.
   * @param onIdentitySettled Runs after the identity fetch resolves or fails.
   */
  constructor(
    private readonly host: ReactiveControllerHost & HTMLElement,
    private readonly resolve: () => Api,
    private readonly onIdentitySettled?: () => void,
  ) {
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
   * `zitadel-signout` and resolves `true` on success; on failure sets
   * `errorMessage` and resolves `false`.
   */
  async signOut(): Promise<boolean> {
    this.loading = true;
    this.errorMessage = "";
    this.host.requestUpdate();

    try {
      await revokeSession(this.resolve());
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      this.errorMessage = message || "Sign-out failed. Please try again.";
      this.loading = false;
      this.host.requestUpdate();
      return false;
    }

    this.loading = false;
    this.host.requestUpdate();
    emit(this.host, "zitadel-signout", { display: this.display, identifier: this.identifier });
    return true;
  }

  private maybeLoadIdentity(): void {
    if (this.identityRequested) return;
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
    try {
      const session = await getSession(api);
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
