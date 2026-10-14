import { css, html, nothing } from "lit";
import { property } from "lit/decorators.js";

import { resolveApi } from "./resolve-api.js";
import { SessionController } from "./session-controller.js";
import { ZitadelSurface } from "./surface.js";
import { defineOnce } from "../internal/define-once.js";
import { orDefault } from "../internal/or-default.js";
import { baseHostStyles, t } from "../styles/index.js";

import "../atoms/index.js";

const DEFAULT_HEADING = "Signed in as";
const DEFAULT_LOGOUT_LABEL = "Sign out";

// How long a no-session navigation from one page to another is remembered.
// Long enough to span a redirect back and the reload it causes, short enough
// that a visitor who returns on purpose later is sent on again.
const LEAVE_LOOP_WINDOW_MS = 10_000;
const LEAVE_STORAGE_KEY = "zitadel-session:no-session-leave";

interface LastLeave {
  readonly from: string;
  readonly to: string;
  readonly at: number;
}

/**
 * A page's identity for the same-page and loop checks: origin, path without
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

function samePage(a: URL, b: URL): boolean {
  return pageKey(a) === pageKey(b);
}

// Storage can be missing or throw (privacy modes, sandboxed frames); the
// guard is then off and the card navigates as before.
function readLastLeave(): LastLeave | undefined {
  try {
    const raw = window.sessionStorage.getItem(LEAVE_STORAGE_KEY);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return undefined;
    const { from, to, at } = value as Record<string, unknown>;
    return typeof from === "string" && typeof to === "string" && typeof at === "number"
      ? { from, to, at }
      : undefined;
  } catch {
    return undefined;
  }
}

function writeLastLeave(value: LastLeave): void {
  try {
    window.sessionStorage.setItem(LEAVE_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // See readLastLeave.
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
 *   authenticates it. The card names the user by `user.display`, then
 *   `user.identifier` (the login identifier), then `user_id`, the first that
 *   is set.
 * - **No session.** When that request answers the backend's
 *   `401 auth.unauthorized` or `404 sess.not_found` (or names no user) the
 *   visitor is signed out: the element fires `zitadel-session-missing`, then
 *   navigates to `post-sign-out-url` when one is set and otherwise renders
 *   nothing. It never navigates to the page it is on (same origin, path with
 *   or without a trailing slash, and query): it renders nothing there instead,
 *   so a card whose sign-out comes back to its own page does not reload it
 *   forever. Nor does it repeat a navigation this page made within the last
 *   ten seconds (kept in `sessionStorage`), which stops the loop when the
 *   target redirects back here. Anything else is not
 *   "signed out": a network error, a 5xx, a
 *   gateway's 401 or 404 without the backend's code, or a 200 that is not a
 *   session keeps the card and shows the error.
 * - **Sign out** calls the typed `revokeMySession` operation
 *   (`DELETE /sessions/me`); the server clears the session cookie. On success
 *   (the backend's no-session answers count, the session is already gone) the
 *   element fires `zitadel-signout` (detail `{ display, identifier }`,
 *   matching the shared SPA contract), then navigates to `post-sign-out-url`,
 *   or without one renders nothing. Any other failure shows the error.
 *
 * A "Continue" action is intentionally omitted for now: the post-sign-in
 * destination contract is still being decided. Consumers redirect after
 * sign-in via the `<zitadel-login>` `post-sign-in-url`.
 */
@defineOnce("zitadel-session")
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

  /** Heading text. Unset, `null` or `""` show the English default. */
  @property({ type: String })
  get heading(): string {
    return this.#heading;
  }
  set heading(value: string | null | undefined) {
    this.#heading = orDefault(value, DEFAULT_HEADING);
  }
  #heading = DEFAULT_HEADING;

  /** Sign-out action label. Unset, `null` or `""` show the English default. */
  @property({ type: String, attribute: "logout-label" })
  get logoutLabel(): string {
    return this.#logoutLabel;
  }
  set logoutLabel(value: string | null | undefined) {
    this.#logoutLabel = orDefault(value, DEFAULT_LOGOUT_LABEL);
  }
  #logoutLabel = DEFAULT_LOGOUT_LABEL;

  private readonly session = new SessionController(
    this,
    () => resolveApi(this.project, this.projectAttrs, "<zitadel-session>"),
    {
      // A card on the page its `post-sign-out-url` names ("sign out and come
      // back here") would otherwise reload that page on every signed-out
      // visit, and find no session again each time.
      onSessionMissing: () => this.leaveWithoutSession(),
    },
  );

  /** Navigates to `postSignOutUrl` when one is set; reports whether it did. */
  private leave(): boolean {
    if (!this.postSignOutUrl || typeof window === "undefined") return false;
    window.location.assign(this.postSignOutUrl);
    return true;
  }

  /**
   * The no-session navigation to `postSignOutUrl`, skipped when that URL is
   * this page, or when this page made the same navigation moments ago: the
   * host or the server sent the visitor back here (a redirect from the target
   * to this page), and navigating again would reload the two pages forever.
   */
  private leaveWithoutSession(): void {
    if (!this.postSignOutUrl || typeof window === "undefined") return;
    let here: URL;
    let target: URL;
    try {
      here = new URL(window.location.href);
      target = new URL(this.postSignOutUrl, here);
    } catch {
      return;
    }
    if (samePage(here, target)) return;
    const from = pageKey(here);
    const to = pageKey(target);
    const now = Date.now();
    const last = readLastLeave();
    if (last && last.from === from && last.to === to && now - last.at < LEAVE_LOOP_WINDOW_MS) {
      return;
    }
    writeLastLeave({ from, to, at: now });
    this.leave();
  }

  override willUpdate(): void {
    // No tenant branding payload on this surface (yet) — the theme resolves
    // from the element preference and the variant fallback.
    this.applySurfaceTheme(undefined);
  }

  /**
   * Signs out, then navigates to `postSignOutUrl`, or, without one, stays and
   * drops the identity, which leaves the card empty: there is nobody left to
   * name or sign out. A failure stays put.
   */
  private async doLogout(): Promise<void> {
    if (!(await this.session.signOut())) return;
    if (this.leave()) return;
    this.session.clearIdentity();
  }

  private handleLogout(event: Event): void {
    event.preventDefault();
    void this.doLogout();
  }

  override render() {
    // No session (none at load, or signed out in place): a "Signed in as"
    // card with a Sign out button would describe nobody.
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
