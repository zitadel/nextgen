import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { AtomManifest } from "../manifest.js";
import { baseHostStyles } from "../styles/base.js";
import { cssTokenVar as v } from "../styles/css-helpers.js";
import { tokens } from "../tokens/catalogue.js";

/**
 * Atom: `<zl-error>` — step-level error outlet.
 *
 * Templates render at most one of these per step (the `{% fallback_ui %}`
 * tag appends one if missing). The host stays in the DOM but collapses to
 * `display: none` when there's neither a `message` property nor slotted
 * content, so layout templates don't have to branch on whether errors exist.
 *
 * Spec: `docs/design/branding/templates.md` (contract: "A `<zl-error>` outlet
 * for step-level errors.").
 */
@customElement("zl-error")
export class ZlError extends LitElement {
  static override styles = [
    baseHostStyles,
    css`
      :host {
        display: block;
      }
      :host(:not([data-has-content])) {
        display: none;
      }
      .root {
        display: flex;
        align-items: flex-start;
        gap: ${v(tokens.space.s2)};
        padding: ${v(tokens.space.s2)} ${v(tokens.space.s3)};
        border-radius: ${v(tokens.radius.md)};
        border: ${v(tokens.border.width)} solid ${v(tokens.color.error)};
        background: rgba(220, 38, 38, 0.06);
        color: ${v(tokens.color.error)};
        font-size: ${v(tokens.font.sizeSm)};
        line-height: ${v(tokens.font.lineHeightNormal)};
      }
    `,
  ];

  @property() accessor message = "";

  @state() private accessor hasSlotted = false;

  override willUpdate(): void {
    const hasContent = Boolean(this.message) || this.hasSlotted;
    this.toggleAttribute("data-has-content", hasContent);
  }

  private handleSlotChange = (event: Event): void => {
    const slot = event.target as HTMLSlotElement;
    this.hasSlotted = slot.assignedNodes({ flatten: true }).length > 0;
  };

  override render() {
    const hasContent = Boolean(this.message) || this.hasSlotted;
    if (!hasContent) {
      return html`<slot @slotchange=${this.handleSlotChange}></slot>`;
    }
    return html`
      <div class="root" part="root" role="alert">
        <span part="message">
          <slot @slotchange=${this.handleSlotChange}>${this.message || nothing}</slot>
        </span>
      </div>
    `;
  }
}

export const zlErrorManifest: AtomManifest = {
  tag: "zl-error",
  attrs: ["message"],
  parts: ["root", "message"],
  slots: [],
  events: [],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-error": ZlError;
  }
}
