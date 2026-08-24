import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

import cardStyles from "./zl-card.css?inline";

import type { AtomManifest } from "../manifest.js";
import { baseHostStyles, surfaceStyles } from "../styles/index.js";

/**
 * Atom: `<zl-card>` — the auth-card surface used by every flow screen.
 *
 * The shadcn `Card`, re-skinned with our tokens. Geometry is constant across
 * the sign-in, sign-in-with-alert, sign-up and passkey-upsell frames:
 *
 *   width       384px (container.auth-card); narrower viewports let it shrink
 *               to the page shell's content width
 *   background  --zl-card — a *filled* surface, not the outlined transparent
 *               card it used to be
 *   border      1px --zl-border
 *   radius      --zl-radius-xl (14px)
 *   padding     24px block on the card, 24px inline on each region
 *   gap         24px between header / body / footer
 *   shadow      --zl-shadow-sm
 *
 *   Internal gaps:
 *     header    6px — title → description stack
 *     body      28px — field group → action group. The groups carry their own
 *               tighter gaps (12px) from the orchestrator's layout chrome,
 *               because the card only sees a flat slot.
 */
@customElement("zl-card")
export class ZlCard extends LitElement {
  static override styles = [baseHostStyles, ...surfaceStyles(cardStyles)];

  @property({ type: Boolean, reflect: true }) accessor compact = false;

  override render() {
    const hasHeader = this.lightDomSlotFilled("header");
    const hasFooter = this.lightDomSlotFilled("footer");
    const cardClass = this.compact ? "zr-card zr-card--compact" : "zr-card";
    const headerClass = hasHeader ? "zr-card__header" : "zr-card__header zr-card__region--empty";
    const footerClass = hasFooter ? "zr-card__footer" : "zr-card__footer zr-card__region--empty";
    return html`
      <section class=${cardClass} part="card">
        <header class=${headerClass} part="header">
          <slot name="header" @slotchange=${this.onSlotChange}></slot>
        </header>
        <div class="zr-card__body" part="body">
          <slot></slot>
        </div>
        <footer class=${footerClass} part="footer">
          <slot name="footer" @slotchange=${this.onSlotChange}></slot>
        </footer>
      </section>
    `;
  }

  /**
   * `lightDomSlotFilled` is a render-time snapshot, so re-run render whenever a
   * named slot's assignment changes (e.g. a header added after first paint).
   * The initial render still reads children synchronously, avoiding the
   * empty-then-filled flash a slotchange-only approach would introduce.
   */
  private onSlotChange = (): void => {
    this.requestUpdate();
  };

  /** Slotted nodes are always light-DOM children of the host in our templates. */
  private lightDomSlotFilled(slot: string): boolean {
    for (const child of this.children) {
      if (child.getAttribute("slot") === slot) return true;
    }
    return false;
  }
}

export const zlCardManifest: AtomManifest = {
  tag: "zl-card",
  attrs: ["compact"],
  parts: ["card", "header", "body", "footer"],
  slots: ["", "header", "footer"],
  events: [],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-card": ZlCard;
  }
}
