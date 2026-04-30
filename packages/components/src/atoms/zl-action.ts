import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

import type { AtomManifest } from "../manifest.js";
import { baseHostStyles } from "../styles/base.js";
import { cssTokenVar as v } from "../styles/css-helpers.js";
import { focusVisibleStyles } from "../styles/focus-ring.js";
import { tokens } from "../tokens/catalogue.js";

/**
 * Atom: `<zl-action>` — secondary / ghost call-to-action wired to a non-primary
 * step action (`register`, `forgot-password`, `back`, etc.).
 *
 * Templates render at most one per non-primary action. Use `ghost` for the
 * link-style variant; default is the muted secondary button.
 *
 * Spec: `docs/design/branding/templates.md`,
 * `docs/design/flowengine/flow-engine-guide.md`.
 */
@customElement("zl-action")
export class ZlAction extends LitElement {
  static override styles = [
    baseHostStyles,
    css`
      :host {
        display: inline-flex;
      }
      .root {
        display: inline-flex;
      }
      .button {
        all: unset;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: ${v(tokens.space.s2)};
        height: ${v(tokens.control.heightMd)};
        padding-inline: ${v(tokens.control.paddingX)};
        border-radius: ${v(tokens.radius.md)};
        font-size: ${v(tokens.font.sizeSm)};
        font-weight: ${v(tokens.font.weightMedium)};
        color: ${v(tokens.color.text)};
        background-color: ${v(tokens.color.muted)};
        transition:
          background-color ${v(tokens.motion.durationFast)} ${v(tokens.motion.easeDefault)},
          color ${v(tokens.motion.durationFast)} ${v(tokens.motion.easeDefault)};
      }
      .button:hover:not([disabled]) {
        background-color: ${v(tokens.color.border)};
      }
      .button:focus-visible {
        ${focusVisibleStyles};
      }
      .button[disabled] {
        cursor: not-allowed;
        opacity: 0.6;
      }
      :host([ghost]) .button {
        background-color: transparent;
        color: ${v(tokens.color.link)};
        padding-inline: 0;
      }
      :host([ghost]) .button:hover:not([disabled]) {
        background-color: transparent;
        text-decoration: underline;
      }
      :host([full-width]) {
        display: flex;
      }
      :host([full-width]) .root,
      :host([full-width]) .button {
        flex: 1 1 auto;
        width: 100%;
      }
    `,
  ];

  @property() accessor action = "";

  @property() accessor label = "";

  @property({ type: Boolean, reflect: true }) accessor ghost = false;

  @property({ type: Boolean }) accessor disabled = false;

  @property({ type: Boolean, reflect: true, attribute: "full-width" }) accessor fullWidth = false;

  override render() {
    return html`
      <div class="root" part="root">
        <button
          class="button"
          part="button"
          type="button"
          ?disabled=${this.disabled}
          @click=${this.handleClick}
        >
          <slot>${this.label}</slot>
        </button>
      </div>
    `;
  }

  private handleClick = (event: MouseEvent) => {
    if (this.disabled) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    this.dispatchEvent(
      new CustomEvent("zl-action", {
        bubbles: true,
        composed: true,
        detail: { action: this.action || null },
      }),
    );
  };
}

export const zlActionManifest: AtomManifest = {
  tag: "zl-action",
  attrs: ["action", "label", "ghost", "disabled", "full-width"],
  parts: ["root", "button"],
  slots: [],
  events: ["zl-action"],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-action": ZlAction;
  }
}
