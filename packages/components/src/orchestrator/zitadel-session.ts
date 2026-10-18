import { css, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { property } from "../internal/property.js";

import { resolveApi } from "./resolve-api.js";
import { SessionController } from "./session-controller.js";
import { ZitadelSurface } from "./surface.js";
import { baseHostStyles, t } from "../styles/index.js";

import "../atoms/index.js";

/**
 * A page's identity for the same-page and referrer checks: origin, path without
 * a trailing slash (hosts add or strip it with a redirect) and the query
 * parameters in key order. The fragment is ignored, since assigning one does
 * not reload.
 */
function pageKey(url: URL): string {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(url.search);
  params.sort();
  return `${url.origin}${path}?${params.toString()}`;
}

/** Parses a URL, or returns `undefined` when `value` is not one. */
function parseUrl(value: string, base?: string): URL | undefined {
  try {
    return new URL(value, base);
  } catch {
    return undefined;
  }
}

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
 *   human-readable `name`/`email` on `/sessions/me`.
 * - **No session.** When the backend answers that request with its
 *   `401 auth.unauthorized` or `404 sess.not_found` (or names no user) the
 *   visitor is signed out: the element navigates to `post-sign-out-url` when
 *   one is set and otherwise renders nothing. It never navigates to the page
 *   it is on (same origin, path with or without a trailing slash, and query):
 *   it renders nothing there instead, so a card whose sign-out comes back to
 *   its own page does not reload it forever. Nor does it navigate when the
 *   visitor was sent here from the target or from this page (the browser's
 *   referrer), which stops the loop when the target redirects back here. Anything else is
 *   not "signed out": a network error, a 5xx, a gateway's 401 or 404 without
 *   the backend's code, or a 200 that is not a session keeps the card and
 *   shows the error.
 * - **Sign out** calls the typed `revokeMySession` operation
 *   (`DELETE /sessions/me`); the server clears the session cookie. On success
 *   (the backend's no-session answer counts, the session is already gone) the
 *   element fires `zitadel-signout` (detail `{ display, identifier }`, matching
 *   the shared SPA contract) and optionally navigates to `post-sign-out-url`.
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

  /**
   * URL to navigate to after a successful sign-out, and when the visitor has no
   * session, unless it is the page the card is on (a trailing slash, the query
   * order and the fragment aside) or this page sent the visitor there moments
   * ago and got them back.
   */
  @property({ type: String, attribute: "post-sign-out-url" }) accessor postSignOutUrl = "";

  /** Heading text. Defaults to the English label. */
  @property({ type: String }) accessor heading = "Signed in as";

  /** Sign-out action label. */
  @property({ type: String, attribute: "logout-label" }) accessor logoutLabel = "Sign out";

  private readonly session = new SessionController(
    this,
    () => resolveApi(this.project, this.projectAttrs, "<zitadel-session>").api,
    // A card on the page its `post-sign-out-url` names ("sign out and come
    // back here") would otherwise reload that page on every signed-out visit,
    // and find no session again each time.
    { onSessionMissing: () => this.leaveWithoutSession() },
  );

  /** Navigates to `postSignOutUrl` when one is set; reports whether it did. */
  private leave(): boolean {
    if (!this.postSignOutUrl || typeof window === "undefined") return false;
    window.location.assign(this.postSignOutUrl);
    return true;
  }

  /**
   * The no-session navigation to `postSignOutUrl`. It is skipped when that URL is
   * this page, or when the visitor was sent here from this page or from that URL
   * (the browser keeps the original referrer across redirects): navigating again
   * would reload the two pages forever.
   */
  private leaveWithoutSession(): void {
    if (this.postSignOutUrl && typeof window !== "undefined") {
      // `location.assign()` resolves a relative URL against the document base
      // (a `<base href>`), not the page's own URL, so the check must too.
      const target = parseUrl(this.postSignOutUrl, document.baseURI);
      const here = parseUrl(window.location.href);

      if (target !== undefined && here !== undefined) {
        // An empty or unreadable referrer proves nothing about where the visitor was.
        const referrer = document.referrer === "" ? undefined : parseUrl(document.referrer);

        const targetKey = pageKey(target);
        const hereKey = pageKey(here);
        const referrerKey = referrer === undefined ? undefined : pageKey(referrer);

        if (targetKey === hereKey) {
          // Stay: the sign-out page is this page, so navigating would reload it forever.
        } else if (referrerKey === hereKey) {
          // Stay: the visitor was sent here from this page, so a redirect brought
          // them straight back and another hop would loop.
        } else if (referrerKey === targetKey) {
          // Stay: the visitor was sent here from the sign-out page, which redirected
          // back to this page, so another hop would loop.
        } else {
          // The visitor arrived from somewhere else, so this is a normal sign-out.
          this.leave();
        }
      } else {
        // Stay: a URL the browser cannot read is one it cannot navigate to either.
      }
    } else {
      // Stay: there is no sign-out page to go to, or no browser to navigate in.
    }
  }

  override willUpdate(): void {
    // No tenant branding payload on this surface (yet) — the theme resolves
    // from the element preference and the variant fallback.
    this.applySurfaceTheme(undefined);
  }

  /** Signs out, then optionally navigates to `postSignOutUrl`; a failure stays put. */
  private async doLogout(): Promise<void> {
    if (!(await this.session.signOut())) return;
    this.leave();
  }

  private handleLogout(event: Event): void {
    event.preventDefault();
    void this.doLogout();
  }

  override render() {
    // No session at load: a "Signed in as" card with a Sign out button would
    // describe nobody.
    if (this.session.state === "signed-out") return nothing;
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
