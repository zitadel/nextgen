import { css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { applyBaseTokens, applyBrandingTokens } from "./branding-to-tokens.js";
import { resolveApi } from "./resolve-api.js";
import { SessionController } from "./session-controller.js";
import { ZitadelConfigured, stampTheme } from "./surface.js";
import { ThemeController, type ThemeMode } from "./theme-controller.js";
import { baseHostStyles, focusVisibleStyles, t } from "../styles/index.js";

import "../atoms/zl-icon.js";

/**
 * `<zitadel-logout>` — orchestrator-tier element that lets the signed-in user
 * sign out without touching the flow API.
 *
 * Reads the user's identity from the typed `getMySession` operation
 * (`GET /sessions/me`, credentialed) — the same source as `<zitadel-session>`,
 * so both signed-in surfaces stay consistent and work against the real backend.
 * The avatar/preview show `name`, then `email`, then the always-present
 * `user_id`. NOTE: the current server response includes only the `user_id`, so
 * the avatar falls back to the id until the backend returns a human-readable
 * `name`/`email`.
 *
 * It renders an avatar trigger with a dropdown that exposes a "Sign out"
 * action, and calls the typed `revokeMySession` operation in `@zitadel/api`
 * (`DELETE /sessions/me`). The server clears the session cookie via
 * `Set-Cookie: Max-Age=0`; on success the element fires `zitadel-signout`
 * and optionally navigates to `post-sign-out-url`.
 *
 * ## Template-slot mode
 *
 * When the consumer projects a `<template>` child the element renders the
 * template's clone into its light DOM with `{{display}}`, `{{identifier}}`,
 * and `{{initial}}` substituted (`{{name}}` and `{{email}}` fill as legacy
 * aliases of the first two). Any element with `data-action="logout"` inside
 * the cloned template triggers the sign-out flow. This mirrors the
 * placeholder `<nextgen-logout>`'s contract so existing markup keeps working.
 *
 * Default styles consume the `--zl-*` design tokens so tenant branding
 * applies automatically.
 */
@customElement("zitadel-logout")
export class ZitadelLogout extends ZitadelConfigured {
  static override styles = [
    baseHostStyles,
    css`
      :host {
        display: inline-block;
        position: relative;
      }

      .trigger {
        all: unset;
        cursor: pointer;
        width: 2.5rem;
        height: 2.5rem;
        border-radius: ${t.radius.full};
        background: ${t.theme.primary};
        color: ${t.theme.primaryForeground};
        font-size: ${t.text.sm.size};
        font-weight: ${t.font.weight.semibold};
        display: inline-flex;
        align-items: center;
        justify-content: center;
        letter-spacing: 0.02em;
        user-select: none;
        transition: box-shadow ${t.motion.duration.fast} ${t.motion.easing.standard};
      }
      .trigger:focus-visible {
        ${focusVisibleStyles};
      }
      .trigger[aria-expanded="true"] {
        box-shadow: 0 0 0 2px ${t.theme.ring};
      }

      .dropdown {
        position: absolute;
        top: calc(100% + ${t.spacing["2"]});
        right: 0;
        width: 14rem;
        background: ${t.theme.popover};
        border: 1px solid ${t.theme.border};
        border-radius: ${t.radius.lg};
        box-shadow: ${t.shadow.lg};
        z-index: 9999;
        overflow: hidden;
      }

      .preview {
        display: flex;
        align-items: center;
        gap: ${t.spacing["4"]};
        padding: ${t.spacing["4"]};
        border-bottom: 1px solid ${t.theme.border};
      }
      .preview-avatar {
        flex-shrink: 0;
        width: 2.5rem;
        height: 2.5rem;
        border-radius: ${t.radius.full};
        background: ${t.theme.primary};
        color: ${t.theme.primaryForeground};
        font-size: ${t.text.sm.size};
        font-weight: ${t.font.weight.semibold};
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .preview-info {
        min-width: 0;
        flex: 1;
      }
      .preview-name {
        font-size: ${t.text.sm.size};
        font-weight: ${t.font.weight.semibold};
        color: ${t.theme.foreground};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .preview-email {
        font-size: ${t.text.xs.size};
        color: ${t.theme.mutedForeground};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: ${t.spacing["0-5"]};
      }

      .actions {
        padding: ${t.spacing["2"]};
      }
      .signout-btn {
        all: unset;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: ${t.spacing["2"]};
        width: 100%;
        padding: ${t.spacing["2"]} ${t.spacing["4"]};
        border-radius: ${t.radius.md};
        color: ${t.theme.destructive};
        font-size: ${t.text.sm.size};
        font-weight: ${t.font.weight.medium};
        box-sizing: border-box;
      }
      .signout-btn:hover:not([disabled]) {
        background: color-mix(in srgb, ${t.theme.destructive} 12%, transparent);
      }
      .signout-btn:focus-visible {
        ${focusVisibleStyles};
      }
      .signout-btn[disabled] {
        cursor: not-allowed;
        opacity: 0.5;
      }
      .signout-btn svg {
        flex-shrink: 0;
      }

      .error-bar {
        padding: ${t.spacing["2"]} ${t.spacing["4"]};
        font-size: ${t.text.xs.size};
        color: ${t.theme.destructive};
        background: color-mix(in srgb, ${t.theme.destructive} 12%, transparent);
        border-top: 1px solid ${t.theme.border};
      }
    `,
  ];

  /** URL to navigate to after a successful sign-out. */
  @property({ type: String, attribute: "post-sign-out-url" }) accessor postSignOutUrl = "";

  /**
   * Colour mode: `light`, `dark`, or `auto` (follow `prefers-color-scheme`).
   * Empty means "not stated" and defaults to `auto` — the control lives
   * inside the app's own chrome, so it follows the visitor's preference
   * rather than forcing the dark login surface. Set it explicitly when the
   * surrounding app surface is fixed: `<zitadel-logout theme="dark">`.
   */
  @property({ type: String }) accessor theme: "" | ThemeMode = "";

  @state() private accessor open = false;

  // Set once in `connectedCallback` based on whether a `<template>` child is
  // present. Not reactive — switching modes mid-life would require re-running
  // light-DOM mutation, which we don't support.
  private templateMode = false;

  // The consumer-supplied `<template>` and its currently projected clone. The
  // template is re-projected whenever identity changes so a late config /
  // identity fetch updates the light-DOM markup rather than leaving it blank.
  private pendingTemplate: HTMLTemplateElement | null = null;

  private projectedContainer: HTMLElement | null = null;

  private readonly themeController = new ThemeController(this);

  // Re-projects once identity settles so template-mode markup shows it.
  private readonly session = new SessionController(
    this,
    () => resolveApi(this.project, this.projectAttrs, "<zitadel-logout>").api,
    () => this.projectTemplate(),
  );

  override connectedCallback(): void {
    super.connectedCallback();

    const tmpl = this.querySelector("template");
    if (tmpl instanceof HTMLTemplateElement) {
      this.templateMode = true;
      this.pendingTemplate = tmpl;
      // Project immediately so the logout control renders even before (or
      // without) a resolvable config; it is re-projected once identity loads.
      this.projectTemplate();
    }

    document.addEventListener("click", this.handleDocumentClick);
    document.addEventListener("keydown", this.handleDocumentKeydown);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("click", this.handleDocumentClick);
    document.removeEventListener("keydown", this.handleDocumentKeydown);
  }

  override willUpdate(): void {
    // No branding payload reaches this element (yet); the empty overrides
    // call keeps the token pipeline identical to the other orchestrator
    // surfaces so a future branding input only has to change the argument.
    this.themeController.setModePreference(this.theme === "" ? undefined : this.theme, "auto");
    const root = this.shadowRoot;
    if (root && !this.templateMode) {
      applyBaseTokens(root);
      applyBrandingTokens(root, undefined);
    }
    stampTheme(this, this.themeController);
  }

  private get initial(): string {
    const source = this.session.label;
    return source ? source.charAt(0).toUpperCase() : "?";
  }

  /**
   * Clones the consumer-supplied `<template>` into the light DOM, fills the
   * `{{display}}`, `{{identifier}}`, and `{{initial}}` tokens (plus the
   * legacy `{{name}}`/`{{email}}` aliases) via a TreeWalker, and
   * wires every element with `data-action="logout"` to trigger sign-out.
   * Light-DOM mounting is deliberate so the consumer's existing CSS applies.
   *
   * Re-runnable: each call replaces the previously projected clone, so a late
   * identity fetch (or a `project` assigned post-mount) updates the rendered
   * markup instead of leaving the placeholders stuck on their initial values.
   */
  private projectTemplate(): void {
    if (!this.templateMode || !this.pendingTemplate) return;

    const clone = this.pendingTemplate.content.cloneNode(true) as DocumentFragment;
    fillTemplateTokens(clone, this.session.display, this.session.identifier, this.initial);

    const container = document.createElement("span");
    container.appendChild(clone);
    this.projectedContainer?.remove();
    this.projectedContainer = container;
    this.appendChild(container);

    const targets = container.querySelectorAll<HTMLElement>('[data-action="logout"]');
    targets.forEach((el) => {
      el.addEventListener("click", (event) => {
        event.preventDefault();
        void this.doLogout();
      });
    });
  }

  private readonly handleDocumentClick = (event: MouseEvent): void => {
    if (!this.open) return;
    if (event.composedPath().includes(this)) return;
    this.open = false;
  };

  private readonly handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (!this.open) return;
    if (event.key !== "Escape") return;
    this.open = false;
    this.shadowRoot?.querySelector<HTMLButtonElement>(".trigger")?.focus();
  };

  private toggleOpen(): void {
    this.open = !this.open;
    this.session.clearError();
  }

  /** Signs out, closes the menu, then optionally navigates to `postSignOutUrl`. */
  private async doLogout(): Promise<void> {
    const closeMenu = () => {
      this.open = false;
    };
    if (!(await this.session.signOut(closeMenu))) return;
    if (this.postSignOutUrl && typeof window !== "undefined") {
      window.location.href = this.postSignOutUrl;
    }
  }

  private handleSignOutClick(event: Event): void {
    event.preventDefault();
    void this.doLogout();
  }

  override render() {
    if (this.templateMode) {
      // Rendering happens into the light DOM via `projectTemplate`. The
      // shadow root stays empty so the projected markup is the only thing
      // the user sees.
      return nothing;
    }

    return html`
      <button
        class="trigger"
        type="button"
        aria-label=${this.open ? "Close user menu" : "Open user menu"}
        aria-expanded=${this.open ? "true" : "false"}
        aria-haspopup="dialog"
        @click=${this.toggleOpen}
      >
        ${this.initial}
      </button>

      ${
        this.open
          ? html`
            <div class="dropdown" role="dialog" aria-label="User menu">
              <div class="preview">
                <div class="preview-avatar" aria-hidden="true">${this.initial}</div>
                <div class="preview-info">
                  <div class="preview-name">${this.session.label}</div>
                  ${
                    this.session.display && this.session.identifier
                      ? html`<div class="preview-email">${this.session.identifier}</div>`
                      : nothing
                  }
                </div>
              </div>

              <div class="actions">
                <button
                  class="signout-btn"
                  type="button"
                  ?disabled=${this.session.loading}
                  @click=${this.handleSignOutClick}
                >
                  ${
                    this.session.loading
                      ? html`<zl-icon name="spinner" size="16" spin decorative></zl-icon>`
                      : html`
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                          <polyline points="16 17 21 12 16 7" />
                          <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                      `
                  }
                  <span>${this.session.loading ? "Signing out…" : "Sign out"}</span>
                </button>
              </div>

              ${
                this.session.errorMessage
                  ? html`<div class="error-bar" role="alert">${this.session.errorMessage}</div>`
                  : nothing
              }
            </div>
          `
          : nothing
      }
    `;
  }
}

/**
 * Substitutes `{{display}}`, `{{identifier}}`, and `{{initial}}` placeholders
 * inside a fragment's text nodes; `{{name}}` and `{{email}}` fill as legacy
 * aliases of display and identifier so pre-ref templates keep rendering.
 * Walking text nodes (rather than running a regex over `outerHTML`) keeps
 * attributes and structural markup untouched.
 */
function fillTemplateTokens(
  fragment: DocumentFragment,
  display: string,
  identifier: string,
  initial: string,
): void {
  // Single pass with a callback: substituted values are never rescanned, so
  // an identity value containing a token-like substring (or a `$&`-style
  // replacement pattern) renders literally instead of being re-substituted.
  const values: Record<string, string> = {
    display,
    identifier,
    name: display,
    email: identifier,
    initial,
  };
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (node.textContent) {
      node.textContent = node.textContent.replace(
        /\{\{(display|identifier|name|email|initial)\}\}/g,
        (_, token: string) => values[token] ?? "",
      );
    }
    node = walker.nextNode() as Text | null;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "zitadel-logout": ZitadelLogout;
  }
}
