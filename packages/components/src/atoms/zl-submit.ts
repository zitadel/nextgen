import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

import type { AtomManifest } from "../manifest.js";
import { baseHostStyles } from "../styles/base.js";
import { cssTokenVar as v } from "../styles/css-helpers.js";
import { focusVisibleStyles } from "../styles/focus-ring.js";
import { tokens } from "../tokens/catalogue.js";

/**
 * Atom: `<zl-submit>` — primary call-to-action wired to the step's primary
 * action. Templates render exactly one per step.
 *
 * Spec: `docs/design/branding/templates.md`,
 * `docs/design/flowengine/flow-engine-guide.md`.
 */
@customElement("zl-submit")
export class ZlSubmit extends LitElement {
  static override styles = [
    baseHostStyles,
    css`
      :host {
        display: block;
      }
      .root {
        display: flex;
        width: 100%;
      }
      .button {
        all: unset;
        cursor: pointer;
        display: inline-flex;
        flex: 1 1 auto;
        align-items: center;
        justify-content: center;
        gap: ${v(tokens.space.s2)};
        height: ${v(tokens.control.heightMd)};
        padding-inline: ${v(tokens.control.paddingX)};
        border-radius: ${v(tokens.radius.md)};
        background-color: ${v(tokens.color.primary)};
        color: ${v(tokens.color.onPrimary)};
        font-size: ${v(tokens.font.sizeMd)};
        font-weight: ${v(tokens.font.weightMedium)};
        box-shadow: ${v(tokens.shadow.sm)};
        transition:
          background-color ${v(tokens.motion.durationFast)} ${v(tokens.motion.easeDefault)},
          filter ${v(tokens.motion.durationFast)} ${v(tokens.motion.easeDefault)};
      }
      .button:hover:not([disabled]) {
        filter: brightness(0.95);
      }
      .button:focus-visible {
        ${focusVisibleStyles};
      }
      .button[disabled] {
        cursor: not-allowed;
        opacity: 0.6;
      }
      .spinner {
        width: 1em;
        height: 1em;
        border-radius: ${v(tokens.radius.full)};
        border: 2px solid currentColor;
        border-top-color: transparent;
        animation: zl-spin 600ms linear infinite;
      }
      @keyframes zl-spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ];

  @property() accessor action = "";

  @property() accessor label = "";

  @property({ type: Boolean }) accessor loading = false;

  @property({ type: Boolean }) accessor disabled = false;

  override render() {
    const blocked = this.disabled || this.loading;
    return html`
      <div class="root" part="root">
        <button
          class="button"
          part="button"
          type="button"
          ?disabled=${blocked}
          aria-busy=${this.loading ? "true" : "false"}
          @click=${this.handleClick}
        >
          ${this.loading
            ? html`<span class="spinner" part="spinner" aria-hidden="true"></span>`
            : null}
          <span><slot>${this.label}</slot></span>
        </button>
      </div>
    `;
  }

  private handleClick = (event: MouseEvent) => {
    if (this.disabled || this.loading) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    this.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: this.action || null },
      }),
    );
  };
}

export const zlSubmitManifest: AtomManifest = {
  tag: "zl-submit",
  consumes: { action: { kind: "submit", required: true } },
  attrs: ["action", "label", "loading", "disabled"],
  parts: ["root", "button", "spinner"],
  slots: [],
  events: ["zl-submit"],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-submit": ZlSubmit;
  }
}
