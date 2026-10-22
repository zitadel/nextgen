import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

import accountStyles from "./zl-account.css?inline";

import { emit } from "../internal/emit.js";
import type { AtomManifest } from "../manifest.js";
import { baseHostStyles, sharedStyles, surfaceStyles } from "../styles/index.js";

import type { ZlSubmitDetail } from "./events.js";
import "./zl-avatar.js";
import "./zl-icon.js";

/**
 * Atom: `<zl-account>` — the account a step signs in to, as a full-width chip.
 *
 * Values:
 *
 *   height      36px (`--zl-spacing-9`), the height of a field
 *   padding     6px start beside the avatar, 12px without it; 12px end
 *   radius      `--zl-radius-md` × 2.25: a pill by default, following the
 *               brand's radius (square with `none`)
 *   gap         8px
 *   border      1px `--zl-border`; `--zl-accent` behind it on hover
 *   font        `--zl-text-sm-*`, the identifier at `--zl-font-weight-medium`
 *
 * The template decides what it shows, per step:
 *
 *   identifier  what the visitor typed; never a user id, so the chip
 *               confirms no account
 *   avatar      the `<zl-avatar>` generated from `identifier`. Leave it off
 *               where no account exists yet, such as a sign-up step.
 *   action      the flow action the whole chip runs, typically the step's
 *               `back`; it then shows a swap icon. Without one the chip is
 *               static.
 *   label       what the action does, for its accessible name and tooltip
 *               (atoms do not translate)
 *
 * A long identifier ends in an ellipsis; the accessible name carries it whole.
 *
 * @fires {CustomEvent<ZlSubmitDetail>} zl-submit - The chip was activated; carries its `action`.
 */
@customElement("zl-account")
export class ZlAccount extends LitElement {
  static override styles = [baseHostStyles, ...surfaceStyles(sharedStyles, accountStyles)];

  @property() accessor identifier = "";

  @property() accessor action: string | undefined = undefined;

  @property() accessor label: string | undefined = undefined;

  @property({ type: Boolean, reflect: true }) accessor avatar = false;

  private handleClick = (event: MouseEvent): void => {
    event.preventDefault();
    if (this.action) void emit<ZlSubmitDetail>(this, "zl-submit", { action: this.action });
  };

  override render() {
    const content = html`
      ${this.avatar ? html`<zl-avatar seed=${this.identifier}></zl-avatar>` : nothing}
      <span class="zr-account__value">${this.identifier}</span>
    `;
    if (!this.action) {
      return html`<span class="zr-account" part="chip">${content}</span>`;
    }
    const label = this.label ? `${this.identifier}, ${this.label}` : this.identifier;
    return html`<a
      href="#"
      class="zr-account zr-account--action zr-focus-ring"
      part="chip"
      title=${this.label ?? nothing}
      aria-label=${label}
      @click=${this.handleClick}
      >${content}<zl-icon name="arrow-left-right" size="16" decorative></zl-icon
    ></a>`;
  }
}

export const zlAccountManifest: AtomManifest = {
  tag: "zl-account",
  attrs: ["identifier", "action", "label", "avatar"],
  parts: ["chip"],
  slots: [],
  events: ["zl-submit"],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-account": ZlAccount;
  }
}
