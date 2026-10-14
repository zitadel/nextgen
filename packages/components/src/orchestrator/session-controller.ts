import type { ReactiveController, ReactiveControllerHost } from "lit";

import { getSession, revokeSession } from "./api-client.js";
import type { resolveApi } from "./resolve-api.js";
import { onConfigChange } from "../internal/config-change.js";
import { emit } from "../internal/emit.js";

type Resolved = ReturnType<typeof resolveApi>;
type Api = Resolved["api"];

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
 * The signed-in identity and the sign-out call shared by `<zitadel-session>`
 * and `<zitadel-logout>`: `GET /sessions/me` for the resolved project (again
 * whenever that project changes), and `DELETE /sessions/me` that fires
 * `zitadel-signout` on success.
 */
export class SessionController implements ReactiveController {
  display = "";

  identifier = "";

  userId = "";

  loading = false;

  errorMessage = "";

  // The project the shown identity belongs to. A host that swaps its
  // `project` (a tenant switch, or a placeholder handle replaced by the real
  // one) must not keep showing the old user while sign-out revokes the new
  // project's session.
  private loadedKey: string | undefined;

  // Bumped per fetch so a slow response for a project that has since been
  // replaced cannot overwrite the newer identity.
  private loadSeq = 0;

  private unsubscribeConfig: (() => void) | undefined;

  /**
   * @param resolve Returns the host's project and API handle, throwing while
   *   no project is resolvable.
   * @param onIdentityChanged Runs after the identity is fetched, fails to
   *   load, or is cleared.
   */
  private readonly host: ReactiveControllerHost & HTMLElement;
  private readonly resolve: () => Resolved;
  private readonly onIdentityChanged?: () => void;

  constructor(
    host: ReactiveControllerHost & HTMLElement,
    resolve: () => Resolved,
    onIdentityChanged?: () => void,
  ) {
    this.host = host;
    this.resolve = resolve;
    this.onIdentityChanged = onIdentityChanged;
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
   * signing out: the revoked session no longer belongs to anyone.
   */
  clearIdentity(): void {
    this.display = "";
    this.identifier = "";
    this.userId = "";
    this.host.requestUpdate();
    this.onIdentityChanged?.();
  }

  /**
   * Revokes the session with credentials; the server clears the cookie. Fires
   * `zitadel-signout` (after `onRevoked`) and resolves `true` on success; on failure sets
   * `errorMessage` and resolves `false`.
   */
  async signOut(onRevoked?: () => void): Promise<boolean> {
    this.loading = true;
    this.errorMessage = "";
    this.host.requestUpdate();

    try {
      await revokeSession(this.resolve().api);
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
    emit(this.host, "zitadel-signout", { display: this.display, identifier: this.identifier });
    return true;
  }

  private maybeLoadIdentity(): void {
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
    }
    void this.loadIdentity(resolved.api, ++this.loadSeq);
  }

  private async loadIdentity(api: Api, seq: number): Promise<void> {
    try {
      const session = await getSession(api);
      if (seq !== this.loadSeq) return;
      this.display = session.user?.display ?? "";
      this.identifier = session.user?.identifier ?? "";
      this.userId = session.user_id ?? "";
    } catch {
      // No active session, or not configured: render without an identity.
    }
    if (seq !== this.loadSeq) return;
    this.host.requestUpdate();
    this.onIdentityChanged?.();
  }
}
