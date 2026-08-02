import { css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { type ZitadelProject } from "@zitadel/api/config";

import { getSession, revokeSession } from "./api-client.js";
import { resolveApi, type ProjectAttrs } from "./resolve-api.js";
import { ZitadelSurface } from "./surface.js";
import { emit } from "../internal/emit.js";
import { baseHostStyles, t } from "../styles/index.js";

import "../atoms/index.js";

/**
 * `<zitadel-session>` — the "signed in" card.
 *
 * Renders the post-sign-in confirmation surface (Figma `7355:8959`): a
 * centred auth card reading "Signed in as {identity}" with a **Sign out**
 * action. Composed from the same `<zl-page-shell>` / `<zl-card>` /
 * `<zl-button>` atoms as the `<zitadel-login>` orchestrator, so it inherits
 * tenant branding tokens with no hardcoded colour, radius, or shadow.
 *
 * Like `<zitadel-login>` it is widget-first: the default `variant="widget"`
 * is content-sized and transparent so the card drops into an app's own
 * page; dedicated signed-in routes opt into `variant="page"`, which claims
 * the viewport and paints the surface background (the page paint lives on
 * the internal `<zl-page-shell>`). `theme` resolves through the shared
 * surface base — explicit value, else `dark` for `page` / `auto` for
 * `widget`.
 *
 * This is the companion surface to `<zitadel-login>` for the "go straight to
 * /login" flow: the orchestrator signs the user in and redirects here (or to
 * the consumer's own page); this element proves the session and offers a way
 * back out. The in-app avatar menu lives in the separate `<zitadel-logout>`.
 *
 * - Identity is fetched from the typed `getMySession` operation
 *   (`GET /sessions/me`), sent with credentials so the session cookie
 *   authenticates it. The card shows `name`, then `email`, then the
 *   always-present `user_id`. NOTE: the current server response includes only
 *   the `user_id`, so the card displays the raw id until the backend returns a
 *   human-readable `name`/`email` on `/sessions/me`. A failed or
 *   unauthenticated request renders the card without an identity line rather
 *   than throwing.
 * - **Sign out** calls the typed `revokeMySession` operation
 *   (`DELETE /sessions/me`); the server clears the session cookie. On success
 *   the element fires `zitadel-signout` (detail `{ name, email }`, matching the
 *   shared SPA contract) and optionally navigates to `post-sign-out-url`.
 *
 * A "Continue" action is intentionally omitted for now: the post-sign-in
 * destination contract is still being decided. Consumers redirect after
 * sign-in via the `<zitadel-login>` `post-sign-in-url`.
 */
@customElement("zitadel-session")
export class ZitadelSession extends ZitadelSurface {
  static override styles = [
    baseHostStyles,
    css`
      :host {
        display: block;
        width: 100%;
      }
      .title {
        margin: 0;
        font-family: ${t.font.family.heading};
        font-size: 2rem;
        font-weight: 700;
        line-height: 2.5rem;
        letter-spacing: -0.02em;
        color: ${t.color.text.primaryWhite};
        text-align: left;
      }
      .identity {
        margin: 0;
        font-family: ${t.font.family.sans};
        font-size: 0.875rem;
        line-height: 1.25rem;
        font-weight: 400;
        color: ${t.color.text.secondaryGray};
        text-align: left;
        overflow-wrap: anywhere;
      }
      .error {
        margin: 0;
        font-size: 0.875rem;
        line-height: 1.25rem;
        color: ${t.color.text.error};
      }
    `,
  ];

  /**
   * SDK project handle returned by `configureZitadel()`. Set from JS (or a
   * framework binding). Takes precedence over the
   * `project-id`/`proxy-path`/`url` attributes and the global singleton.
   */
  @property({ attribute: false }) accessor project: ZitadelProject | undefined;

  /** Project ID, set declaratively in HTML for no-JS configuration. */
  @property({ type: String, attribute: "project-id" }) accessor projectId = "";

  /** Proxy path for API requests (e.g. `/__nextgen`), set declaratively in HTML. */
  @property({ type: String, attribute: "proxy-path" }) accessor proxyPath = "";

  /** Full URL of the Zitadel auth backend, set declaratively in HTML. */
  @property({ type: String }) accessor url = "";

  /** URL to navigate to after a successful sign-out. */
  @property({ type: String, attribute: "post-sign-out-url" }) accessor postSignOutUrl = "";

  /** Heading text. Defaults to the English label. */
  @property({ type: String }) accessor heading = "Signed in as";

  /** Sign-out action label. */
  @property({ type: String, attribute: "logout-label" }) accessor logoutLabel = "Sign out";

  @state() private accessor displayName = "";

  @state() private accessor displayEmail = "";

  @state() private accessor displayUserId = "";

  @state() private accessor loading = false;

  @state() private accessor errorMessage = "";

  // Guards the one-shot identity fetch so it runs once config is resolvable,
  // whether that's at connect time (global config / declarative attributes) or
  // after a framework assigns the `project` property post-mount.
  private identityRequested = false;

  override connectedCallback(): void {
    super.connectedCallback();
    this.maybeLoadIdentity();
  }

  /** Single identity line: human-readable name, then email, then user_id. */
  private get identityLabel(): string {
    return this.displayName || this.displayEmail || this.displayUserId;
  }

  override willUpdate(): void {
    // No tenant branding payload on this surface (yet) — the theme resolves
    // from the element preference and the variant fallback.
    this.applySurfaceTheme(undefined);
  }

  override updated(): void {
    this.maybeLoadIdentity();
  }

  /** Declarative config read from this element's attributes. */
  private get projectAttrs(): ProjectAttrs {
    return { projectId: this.projectId, proxyPath: this.proxyPath, url: this.url };
  }

  /**
   * Fetches the signed-in identity from `GET /sessions/me` once a project is
   * resolvable. No-ops until then (and on repeat calls) so framework property
   * timing doesn't matter and we never fire the request twice.
   */
  private maybeLoadIdentity(): void {
    if (this.identityRequested) return;
    let api;
    try {
      ({ api } = resolveApi(this.project, this.projectAttrs, "<zitadel-session>"));
    } catch {
      return;
    }
    this.identityRequested = true;
    void this.fetchIdentity(api);
  }

  private async fetchIdentity(api: ReturnType<typeof resolveApi>["api"]): Promise<void> {
    try {
      const session = await getSession(api);
      this.displayName = session.name ?? "";
      this.displayEmail = session.email ?? "";
      this.displayUserId = session.user_id ?? "";
    } catch {
      // No active session, or not configured — render without an identity line.
    }
  }

  /**
   * Calls `DELETE /sessions/me` (`revokeMySession`) with credentials. On
   * success fires `zitadel-signout` and optionally navigates to
   * `postSignOutUrl`; on failure surfaces an inline error and stays put.
   */
  private async doLogout(): Promise<void> {
    this.loading = true;
    this.errorMessage = "";

    try {
      const { api } = resolveApi(this.project, this.projectAttrs, "<zitadel-session>");
      await revokeSession(api);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      this.errorMessage = message || "Sign-out failed. Please try again.";
      this.loading = false;
      return;
    }

    this.loading = false;
    emit(this, "zitadel-signout", { name: this.displayName, email: this.displayEmail });

    if (this.postSignOutUrl && typeof window !== "undefined") {
      window.location.assign(this.postSignOutUrl);
    }
  }

  private handleLogout(event: Event): void {
    event.preventDefault();
    void this.doLogout();
  }

  override render() {
    // Static template, so widget polarity is a plain binding — unlike
    // `<zitadel-login>`, whose `zl-page-shell` lives in unsafeHTML-parsed
    // markup and needs the imperative re-stamp loop.
    return html`
      <zl-page-shell ?data-widget=${this.variant !== "page"}>
        <zl-card>
          <h1 slot="header" class="title">${this.heading}</h1>
          ${this.identityLabel
            ? html`<p slot="header" class="identity">${this.identityLabel}</p>`
            : nothing}

          <zl-button
            hierarchy="primary"
            size="medium"
            block
            ?loading=${this.loading}
            data-testid="zitadel-session-logout"
            label=${this.logoutLabel}
            @zl-submit=${this.handleLogout}
          ></zl-button>

          ${this.errorMessage
            ? html`<p class="error" role="alert">${this.errorMessage}</p>`
            : nothing}
        </zl-card>
      </zl-page-shell>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "zitadel-session": ZitadelSession;
  }
}
