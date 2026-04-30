import { LitElement, css, html } from "lit";

/**
 * Internal shape of the decoded `__nextgen_display` cookie.
 */
interface DisplayData {
  readonly name: string;
  readonly email: string;
}

/**
 * `<nextgen-logout>` — reads the signed-in user's identity from the
 * `__nextgen_display` cookie and renders a logout element.
 *
 * ## Default mode (no `<template>` child)
 *
 * Renders a circular avatar trigger. Clicking it opens a small dropdown
 * showing the user's name and email with a "Sign out" action.
 *
 * ## Template mode (`<template>` child present)
 *
 * The component clones the template, fills `{{name}}`, `{{email}}`, and
 * `{{initial}}` tokens, then renders the result into the light DOM so your
 * existing CSS applies. Any element with `data-action="logout"` inside the
 * template triggers the logout flow on click.
 *
 * ```html
 * <nextgen-logout proxy-base="/__nextgen" post-sign-out-url="/login">
 *   <template>
 *     <button data-action="logout">Logout {{name}}</button>
 *   </template>
 * </nextgen-logout>
 * ```
 *
 * @attr {string} proxy-base        - Base path for the auth proxy (default `/__nextgen`).
 * @attr {string} post-sign-out-url - Optional URL to navigate to after sign-out.
 *
 * @fires {CustomEvent} nextgen-signout - Fired after the session cookie is
 *   cleared. Always fires regardless of `post-sign-out-url`. Detail: `{ name, email }`.
 */
class NextgenLogout extends LitElement {
  static override properties = {
    proxyBase: { type: String, attribute: "proxy-base" },
    postSignOutUrl: { type: String, attribute: "post-sign-out-url" },
    _name: { state: true },
    _email: { state: true },
    _open: { state: true },
    _loading: { state: true },
    _error: { state: true },
  };

  static override styles = css`
    :host {
      display: inline-block;
      position: relative;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    /* ── Trigger ─────────────────────────────────────────────────────────── */

    .trigger {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      color: #ffffff;
      font-size: 14px;
      font-weight: 600;
      border: 2px solid transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      letter-spacing: 0.02em;
      user-select: none;
      transition: box-shadow 0.15s, border-color 0.15s;
      outline: none;
    }

    .trigger:hover {
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.25);
    }

    .trigger:focus-visible {
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.4);
    }

    .trigger[aria-expanded="true"] {
      border-color: #6366f1;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
    }

    /* ── Dropdown ────────────────────────────────────────────────────────── */

    .dropdown {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      width: 220px;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      box-shadow:
        0 4px 6px -1px rgba(0, 0, 0, 0.07),
        0 10px 24px -4px rgba(0, 0, 0, 0.1);
      z-index: 9999;
      overflow: hidden;
      animation: dropdown-in 0.12s ease-out;
    }

    @keyframes dropdown-in {
      from {
        opacity: 0;
        transform: translateY(-4px) scale(0.97);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    /* ── User preview ────────────────────────────────────────────────────── */

    .preview {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 14px 12px;
      border-bottom: 1px solid #f3f4f6;
    }

    .preview-avatar {
      flex-shrink: 0;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      color: #ffffff;
      font-size: 14px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .preview-info {
      min-width: 0;
      flex: 1;
    }

    .preview-name {
      font-size: 13px;
      font-weight: 600;
      color: #111827;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .preview-email {
      font-size: 11px;
      color: #9ca3af;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 1px;
    }

    /* ── Actions ─────────────────────────────────────────────────────────── */

    .actions {
      padding: 6px;
    }

    .signout-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 10px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: #dc2626;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      text-align: left;
      transition: background 0.1s;
      outline: none;
    }

    .signout-btn:hover:not(:disabled) {
      background: #fef2f2;
    }

    .signout-btn:focus-visible {
      background: #fef2f2;
      box-shadow: inset 0 0 0 2px #dc2626;
    }

    .signout-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .signout-btn svg {
      flex-shrink: 0;
    }

    /* ── Spinner ─────────────────────────────────────────────────────────── */

    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid currentColor;
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.65s linear infinite;
      flex-shrink: 0;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    /* ── Error ───────────────────────────────────────────────────────────── */

    .error-bar {
      padding: 8px 12px;
      font-size: 12px;
      color: #991b1b;
      background: #fef2f2;
      border-top: 1px solid #fecaca;
    }
  `;

  declare proxyBase: string;
  declare postSignOutUrl: string;
  declare _name: string;
  declare _email: string;
  declare _open: boolean;
  declare _loading: boolean;
  declare _error: string;

  // Not reactive — set once in connectedCallback, never changes.
  private _templateMode: boolean = false;

  constructor() {
    super();
    this.proxyBase = "/__nextgen";
    this.postSignOutUrl = "";
    this._name = "";
    this._email = "";
    this._open = false;
    this._loading = false;
    this._error = "";
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  override connectedCallback() {
    super.connectedCallback();
    this._readDisplayCookie();

    const tmpl = this.querySelector("template") as HTMLTemplateElement | null;
    if (tmpl) {
      this._templateMode = true;
      this._renderTemplate(tmpl);
    }

    document.addEventListener("click", this._onDocumentClick);
    document.addEventListener("keydown", this._onDocumentKeydown);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click", this._onDocumentClick);
    document.removeEventListener("keydown", this._onDocumentKeydown);
  }

  // ── Cookie ───────────────────────────────────────────────────────────────

  /**
   * Reads the `__nextgen_display` cookie (non-HttpOnly, set by the backend
   * on login) and populates `_name` and `_email` for rendering.
   */
  private _readDisplayCookie(): void {
    const match = document.cookie.match(/(?:^|;\s*)__nextgen_display=([^;]+)/);
    if (!match) {
      return;
    }

    try {
      const data = JSON.parse(atob(match[1])) as DisplayData;
      this._name = data.name ?? "";
      this._email = data.email ?? "";
    } catch {
      // Cookie present but malformed — render with empty values.
    }
  }

  /**
   * Returns the uppercased first letter of the user's name or email,
   * used as the avatar initial and as the `{{initial}}` template token.
   */
  private get _initial(): string {
    const source = this._name || this._email;
    return source ? source.charAt(0).toUpperCase() : "?";
  }

  // ── Template mode ────────────────────────────────────────────────────────

  /**
   * Clones the user-supplied `<template>`, fills token placeholders, appends
   * the result to the light DOM, and wires logout handlers.
   */
  private _renderTemplate(tmpl: HTMLTemplateElement): void {
    const clone = tmpl.content.cloneNode(true) as DocumentFragment;
    this._fillTokens(clone);

    const container = document.createElement("span");
    container.appendChild(clone);
    this.appendChild(container);

    const targets = container.querySelectorAll<HTMLElement>("[data-action='logout']");
    targets.forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        void this._doLogout();
      });
    });
  }

  /**
   * Walks all text nodes inside `root` and replaces `{{name}}`, `{{email}}`,
   * and `{{initial}}` with the corresponding display values.
   */
  private _fillTokens(root: DocumentFragment): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;

    while (node) {
      if (node.textContent) {
        node.textContent = node.textContent
          .replace(/\{\{name\}\}/g, this._name)
          .replace(/\{\{email\}\}/g, this._email)
          .replace(/\{\{initial\}\}/g, this._initial);
      }
      node = walker.nextNode() as Text | null;
    }
  }

  // ── Outside-click / keyboard ─────────────────────────────────────────────

  private readonly _onDocumentClick = (event: MouseEvent): void => {
    if (!this._open) {
      return;
    }
    if (!event.composedPath().includes(this)) {
      this._open = false;
    }
  };

  private readonly _onDocumentKeydown = (event: KeyboardEvent): void => {
    if (this._open && event.key === "Escape") {
      this._open = false;
      this.shadowRoot?.querySelector<HTMLButtonElement>(".trigger")?.focus();
    }
  };

  // ── Logout ───────────────────────────────────────────────────────────────

  private _toggleOpen(): void {
    this._open = !this._open;
    this._error = "";
  }

  /**
   * POSTs to `{proxyBase}/v1/logout`, which clears the session cookie via
   * `Set-Cookie: Max-Age=0`. On success fires `nextgen-signout` and
   * optionally navigates to `post-sign-out-url`.
   */
  private async _doLogout(): Promise<void> {
    this._loading = true;
    this._error = "";

    try {
      const res = await fetch(`${this.proxyBase}/v1/logout`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        this._error = body.message ?? `Logout failed (${res.status})`;
        this._loading = false;
        return;
      }
    } catch {
      this._error = "Network error. Please try again.";
      this._loading = false;
      return;
    }

    this._open = false;
    this._loading = false;

    this.dispatchEvent(
      new CustomEvent("nextgen-signout", {
        bubbles: true,
        composed: true,
        detail: { name: this._name, email: this._email },
      }),
    );

    if (this.postSignOutUrl) {
      window.location.href = this.postSignOutUrl;
    }
  }

  private _handleSignOutClick(event: Event): void {
    event.preventDefault();
    void this._doLogout();
  }

  // ── Render ───────────────────────────────────────────────────────────────

  override render() {
    if (this._templateMode) {
      return html``;
    }

    return html`
      <button
        class="trigger"
        aria-label="${this._open ? "Close user menu" : "Open user menu"}"
        aria-expanded="${this._open}"
        aria-haspopup="dialog"
        @click=${this._toggleOpen}
      >
        ${this._initial}
      </button>

      ${this._open
        ? html`
            <div class="dropdown" role="dialog" aria-label="User menu">
              <div class="preview">
                <div class="preview-avatar" aria-hidden="true">${this._initial}</div>
                <div class="preview-info">
                  <div class="preview-name">${this._name || this._email}</div>
                  ${this._name
                    ? html`<div class="preview-email">${this._email}</div>`
                    : html``}
                </div>
              </div>

              <div class="actions">
                <button
                  class="signout-btn"
                  ?disabled=${this._loading}
                  @click=${this._handleSignOutClick}
                >
                  ${this._loading
                    ? html`<div class="spinner" aria-hidden="true"></div>`
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
                  ${this._loading ? "Signing out…" : "Sign out"}
                </button>
              </div>

              ${this._error
                ? html`<div class="error-bar" role="alert">${this._error}</div>`
                : html``}
            </div>
          `
        : html``}
    `;
  }
}

customElements.define("nextgen-logout", NextgenLogout);

export { NextgenLogout };

declare global {
  interface HTMLElementTagNameMap {
    "nextgen-logout": NextgenLogout;
  }
}
