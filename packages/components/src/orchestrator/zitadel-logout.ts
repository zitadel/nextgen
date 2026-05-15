import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  endSession,
  getEndSessionUrl,
} from "@zitadel-nextgen/api/generated/endpoints/zitadelNextGen";

import { baseHostStyles } from "../styles/base.js";
import { cssTokenVar as v } from "../styles/css-helpers.js";
import { focusVisibleStyles } from "../styles/focus-ring.js";
import { tokens } from "../tokens/catalogue.js";

/**
 * Shape of the decoded `__nextgen_display` cookie set by the auth backend on
 * sign-in. The cookie is a base64-encoded JSON object — non-`HttpOnly` so the
 * frontend can render the signed-in user's identity without an extra round
 * trip.
 */
interface DisplayData {
  readonly name: string;
  readonly email: string;
}

const DISPLAY_COOKIE_NAME = "__nextgen_display";

/**
 * `<zitadel-logout>` — orchestrator-tier element that lets the signed-in user
 * sign out without touching the flow API.
 *
 * Reads the user's display name + email from the `__nextgen_display` cookie
 * (set by the auth backend on sign-in), renders an avatar trigger with a
 * dropdown that exposes a "Sign out" action, and calls the typed
 * `endSession` operation in `@zitadel-nextgen/api`
 * (`GET /auth/end-session`). The server clears the session cookie via
 * `Set-Cookie: Max-Age=0`; on success the element fires `zitadel-signout`
 * and optionally navigates to `post-sign-out-url`.
 *
 * ## Template-slot mode
 *
 * When the consumer projects a `<template>` child the element renders the
 * template's clone into its light DOM with `{{name}}`, `{{email}}`, and
 * `{{initial}}` substituted. Any element with `data-action="logout"` inside
 * the cloned template triggers the sign-out flow. This mirrors the
 * placeholder `<nextgen-logout>`'s contract so existing markup keeps working.
 *
 * Default styles consume the `--zl-*` design tokens so tenant branding
 * applies automatically — there is no hardcoded brand colour, radius, or
 * shadow.
 */
@customElement("zitadel-logout")
export class ZitadelLogout extends LitElement {
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
        width: ${v(tokens.control.heightMd)};
        height: ${v(tokens.control.heightMd)};
        border-radius: ${v(tokens.radius.full)};
        background: ${v(tokens.color.primary)};
        color: ${v(tokens.color.onPrimary)};
        font-size: ${v(tokens.font.sizeSm)};
        font-weight: ${v(tokens.font.weightBold)};
        display: inline-flex;
        align-items: center;
        justify-content: center;
        letter-spacing: 0.02em;
        user-select: none;
        transition: box-shadow ${v(tokens.motion.durationFast)} ${v(tokens.motion.easeDefault)};
      }
      .trigger:focus-visible {
        ${focusVisibleStyles};
      }
      .trigger[aria-expanded="true"] {
        box-shadow: 0 0 0 2px ${v(tokens.color.focusRing)};
      }

      .dropdown {
        position: absolute;
        top: calc(100% + ${v(tokens.space.s2)});
        right: 0;
        width: 14rem;
        background: ${v(tokens.color.surface)};
        border: ${v(tokens.border.width)} solid ${v(tokens.color.border)};
        border-radius: ${v(tokens.radius.lg)};
        box-shadow: ${v(tokens.shadow.lg)};
        z-index: 9999;
        overflow: hidden;
      }

      .preview {
        display: flex;
        align-items: center;
        gap: ${v(tokens.space.s3)};
        padding: ${v(tokens.space.s4)};
        border-bottom: ${v(tokens.border.width)} solid ${v(tokens.color.border)};
      }
      .preview-avatar {
        flex-shrink: 0;
        width: ${v(tokens.control.heightMd)};
        height: ${v(tokens.control.heightMd)};
        border-radius: ${v(tokens.radius.full)};
        background: ${v(tokens.color.primary)};
        color: ${v(tokens.color.onPrimary)};
        font-size: ${v(tokens.font.sizeSm)};
        font-weight: ${v(tokens.font.weightBold)};
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .preview-info {
        min-width: 0;
        flex: 1;
      }
      .preview-name {
        font-size: ${v(tokens.font.sizeSm)};
        font-weight: ${v(tokens.font.weightBold)};
        color: ${v(tokens.color.text)};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .preview-email {
        font-size: ${v(tokens.font.sizeXs)};
        color: ${v(tokens.color.textMuted)};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 2px;
      }

      .actions {
        padding: ${v(tokens.space.s2)};
      }
      .signout-btn {
        all: unset;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: ${v(tokens.space.s2)};
        width: 100%;
        padding: ${v(tokens.space.s2)} ${v(tokens.space.s3)};
        border-radius: ${v(tokens.radius.md)};
        color: ${v(tokens.color.error)};
        font-size: ${v(tokens.font.sizeSm)};
        font-weight: ${v(tokens.font.weightMedium)};
        box-sizing: border-box;
      }
      .signout-btn:hover:not([disabled]) {
        background: color-mix(in srgb, ${v(tokens.color.error)} 8%, transparent);
      }
      .signout-btn:focus-visible {
        ${focusVisibleStyles};
      }
      .signout-btn[disabled] {
        cursor: not-allowed;
        opacity: 0.6;
      }
      .signout-btn svg {
        flex-shrink: 0;
      }

      .spinner {
        width: 1em;
        height: 1em;
        border-radius: ${v(tokens.radius.full)};
        border: 2px solid currentColor;
        border-top-color: transparent;
        animation: zl-logout-spin 600ms linear infinite;
      }
      @keyframes zl-logout-spin {
        to {
          transform: rotate(360deg);
        }
      }

      .error-bar {
        padding: ${v(tokens.space.s2)} ${v(tokens.space.s3)};
        font-size: ${v(tokens.font.sizeXs)};
        color: ${v(tokens.color.error)};
        background: color-mix(in srgb, ${v(tokens.color.error)} 8%, transparent);
        border-top: ${v(tokens.border.width)} solid ${v(tokens.color.border)};
      }
    `,
  ];

  /** URL to navigate to after a successful sign-out. */
  @property({ type: String, attribute: "post-sign-out-url" }) accessor postSignOutUrl = "";

  /**
   * OIDC `client_id` to forward as a query parameter on the end-session
   * request, mirroring the standard end-session contract. Optional —
   * leaving this empty is fine when the backend can resolve the client
   * from the session cookie alone.
   */
  @property({ type: String, attribute: "client-id" }) accessor clientId = "";

  @state() private accessor displayName = "";

  @state() private accessor displayEmail = "";

  @state() private accessor open = false;

  @state() private accessor loading = false;

  @state() private accessor errorMessage = "";

  // Set once in `connectedCallback` based on whether a `<template>` child is
  // present. Not reactive — switching modes mid-life would require re-running
  // light-DOM mutation, which we don't support.
  private templateMode = false;

  override connectedCallback(): void {
    super.connectedCallback();
    this.readDisplayCookie();

    const tmpl = this.querySelector("template");
    if (tmpl instanceof HTMLTemplateElement) {
      this.templateMode = true;
      this.renderTemplate(tmpl);
    }

    document.addEventListener("click", this.handleDocumentClick);
    document.addEventListener("keydown", this.handleDocumentKeydown);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("click", this.handleDocumentClick);
    document.removeEventListener("keydown", this.handleDocumentKeydown);
  }

  /**
   * Decodes the `__nextgen_display` cookie (base64-encoded JSON, set by the
   * auth backend on sign-in) and populates `displayName` / `displayEmail`.
   * A missing or malformed cookie is intentionally non-fatal — the dropdown
   * still renders, just with empty values.
   */
  private readDisplayCookie(): void {
    if (typeof document === "undefined") return;
    const match = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${DISPLAY_COOKIE_NAME}=([^;]+)`),
    );
    if (!match || !match[1]) return;
    try {
      const data = JSON.parse(atob(match[1])) as DisplayData;
      this.displayName = typeof data.name === "string" ? data.name : "";
      this.displayEmail = typeof data.email === "string" ? data.email : "";
    } catch {
      // Cookie present but malformed — render with empty values.
    }
  }

  private get initial(): string {
    const source = this.displayName || this.displayEmail;
    return source ? source.charAt(0).toUpperCase() : "?";
  }

  /**
   * Clones a consumer-supplied `<template>` into the light DOM, fills the
   * `{{name}}`, `{{email}}`, and `{{initial}}` tokens via a TreeWalker, and
   * wires every element with `data-action="logout"` to trigger sign-out.
   * Light-DOM mounting is deliberate so the consumer's existing CSS applies.
   */
  private renderTemplate(tmpl: HTMLTemplateElement): void {
    const clone = tmpl.content.cloneNode(true) as DocumentFragment;
    fillTemplateTokens(clone, this.displayName, this.displayEmail, this.initial);

    const container = document.createElement("span");
    container.appendChild(clone);
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
    this.errorMessage = "";
  }

  /**
   * Calls the typed `endSession` operation (`GET /auth/end-session`) with
   * `credentials: "include"`. The server clears the session cookie via
   * `Set-Cookie: Max-Age=0`; on success this element fires `zitadel-signout`
   * and optionally navigates to `postSignOutUrl`.
   */
  private async doLogout(): Promise<void> {
    this.loading = true;
    this.errorMessage = "";

    const params = {
      ...(this.clientId ? { client_id: this.clientId } : {}),
      ...(this.postSignOutUrl ? { post_logout_redirect_uri: this.postSignOutUrl } : {}),
    };

    try {
      await endSession(params, { credentials: "include" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      this.errorMessage = message || "Sign-out failed. Please try again.";
      this.loading = false;
      return;
    }

    this.open = false;
    this.loading = false;

    const detail = { name: this.displayName, email: this.displayEmail };
    this.dispatchEvent(
      new CustomEvent("zitadel-signout", {
        bubbles: true,
        composed: true,
        detail,
      }),
    );

    if (this.postSignOutUrl && typeof window !== "undefined") {
      window.location.href = this.postSignOutUrl;
    }
  }

  /**
   * Returns the absolute URL the end-session request will hit. Useful for
   * test assertions and for consumers that prefer to navigate the browser
   * directly (instead of fetching) so the OIDC session-end redirect is
   * driven by the user agent.
   */
  getEndSessionUrl(): string {
    const params = {
      ...(this.clientId ? { client_id: this.clientId } : {}),
      ...(this.postSignOutUrl ? { post_logout_redirect_uri: this.postSignOutUrl } : {}),
    };
    return getEndSessionUrl(params);
  }

  private handleSignOutClick(event: Event): void {
    event.preventDefault();
    void this.doLogout();
  }

  override render() {
    if (this.templateMode) {
      // Rendering happens once into the light DOM via `renderTemplate`. The
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

      ${this.open
        ? html`
            <div class="dropdown" role="dialog" aria-label="User menu">
              <div class="preview">
                <div class="preview-avatar" aria-hidden="true">${this.initial}</div>
                <div class="preview-info">
                  <div class="preview-name">${this.displayName || this.displayEmail}</div>
                  ${this.displayName
                    ? html`<div class="preview-email">${this.displayEmail}</div>`
                    : nothing}
                </div>
              </div>

              <div class="actions">
                <button
                  class="signout-btn"
                  type="button"
                  ?disabled=${this.loading}
                  @click=${this.handleSignOutClick}
                >
                  ${this.loading
                    ? html`<span class="spinner" aria-hidden="true"></span>`
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
                      `}
                  <span>${this.loading ? "Signing out…" : "Sign out"}</span>
                </button>
              </div>

              ${this.errorMessage
                ? html`<div class="error-bar" role="alert">${this.errorMessage}</div>`
                : nothing}
            </div>
          `
        : nothing}
    `;
  }
}

/**
 * Substitutes `{{name}}`, `{{email}}`, and `{{initial}}` placeholders inside
 * a fragment's text nodes. Walking text nodes (rather than running a regex
 * over `outerHTML`) keeps attributes and structural markup untouched.
 */
function fillTemplateTokens(
  fragment: DocumentFragment,
  name: string,
  email: string,
  initial: string,
): void {
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (node.textContent) {
      node.textContent = node.textContent
        .replace(/\{\{name\}\}/g, name)
        .replace(/\{\{email\}\}/g, email)
        .replace(/\{\{initial\}\}/g, initial);
    }
    node = walker.nextNode() as Text | null;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "zitadel-logout": ZitadelLogout;
  }
}
