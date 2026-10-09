import { css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

import { resolveApi } from "./resolve-api.js";
import { SessionController } from "./session-controller.js";
import { ZitadelSurface } from "./surface.js";
import { baseHostStyles, t } from "../styles/index.js";

import "../atoms/index.js";

/**
 * `<zitadel-session>` — the "signed in" card.
 *
 * Renders the post-sign-in confirmation surface: a
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
 *   the element fires `zitadel-signout` (detail `{ display, identifier }`, matching the
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
      /* The same title as the sign-in card's: xl, medium, on a single line
         whose gap to the identity line does the separating. */
      .title {
        margin: 0;
        font-family: ${t.font.family.heading};
        font-size: var(--zl-text-xl-size);
        font-weight: var(--zl-font-weight-medium);
        line-height: 1;
        color: ${t.theme.foreground};
        text-align: left;
      }
      .identity {
        margin: 0;
        font-family: ${t.font.family.sans};
        font-size: ${t.text.sm.size};
        line-height: ${t.text.sm.leading};
        font-weight: ${t.font.weight.normal};
        color: ${t.theme.mutedForeground};
        text-align: left;
        overflow-wrap: anywhere;
      }
      .error {
        margin: 0;
        font-size: ${t.text.sm.size};
        line-height: ${t.text.sm.leading};
        color: ${t.theme.destructive};
      }
      /* suppress-header: visually hidden, kept in the accessibility tree. */
      .title.sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        border: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
    `,
  ];

  /** URL to navigate to after a successful sign-out. */
  @property({ type: String, attribute: "post-sign-out-url" }) accessor postSignOutUrl = "";

  /** Heading text. Defaults to the English label. */
  @property({ type: String }) accessor heading = "Signed in as";

  /** Sign-out action label. */
  @property({ type: String, attribute: "logout-label" }) accessor logoutLabel = "Sign out";

  private readonly session = new SessionController(
    this,
    () => resolveApi(this.project, this.projectAttrs, "<zitadel-session>").api,
  );

  override willUpdate(): void {
    // No tenant branding payload on this surface (yet) — the theme resolves
    // from the element preference and the variant fallback.
    this.applySurfaceTheme(undefined);
  }

  /** Signs out, then optionally navigates to `postSignOutUrl`; a failure stays put. */
  private async doLogout(): Promise<void> {
    if (!(await this.session.signOut())) return;
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
        <zl-card ?data-suppress-header=${this.suppressHeader}>
          <h1 slot="header" class="title ${this.suppressHeader ? "sr-only" : ""}">
            ${this.heading}
          </h1>
          ${
            this.session.label
              ? html`<p slot=${this.suppressHeader ? nothing : "header"} class="identity">
                ${this.session.label}
              </p>`
              : nothing
          }

          <zl-button
            hierarchy="primary"
            size="medium"
            block
            ?loading=${this.session.loading}
            data-testid="zitadel-session-logout"
            label=${this.logoutLabel}
            @zl-submit=${this.handleLogout}
          ></zl-button>

          ${
            this.session.errorMessage
              ? html`<p class="error" role="alert">${this.session.errorMessage}</p>`
              : nothing
          }
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
