import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import cardHost from "@zitadel-nextgen/shared-component-styles/lit/card-host.css?inline";
import cardSurface from "@zitadel-nextgen/shared-component-styles/card.css?inline";

import type { AtomManifest } from "../manifest.js";
import { baseHostStyles, surfaceStyles } from "../styles/index.js";

/**
 * Atom: `<zl-card>` — the auth-card surface used by every flow screen.
 *
 * Spec lineage (file `xkvBjkOJ8ENuHdTGZHXezK`):
 *   - sign-in: node `6593:141985` (combined sign-in card, 32px gap)
 *   - sign-up: node `6593:141743` / frame `6593:141741` (title only, 32px gap)
 *   - passkey-upsell: node `6594:632` (288h, heading+subtitle, 24px gap)
 *   - signed-in: node `6596:132846` (272h, heading+subtitle, 24px gap)
 *
 * Per-state Figma values (constant across all four screens unless noted):
 *
 *   width       384px fixed (container.auth-card token; xs collapses
 *               to full-width via the surrounding page-shell)
 *   background  transparent — the page (surface.default-black) shows
 *               through; the card is *not* an elevated surface, only
 *               outlined
 *   border      1px solid surface.default-primary-gray (#252528)
 *   radius      16px (radius.l)
 *   padding     32px all sides (spacing-05)
 *   gap         32px between header / body / footer slots (sign-in,
 *               sign-up). Passkey-upsell + signed-in tighten to 24px
 *               (spacing-04) via `compact` because their heading group
 *               carries a subtitle.
 *
 *   Internal slot gaps:
 *     header    8px (spacing-02) — heading → subtitle stack
 *     body      16px (spacing-03) — fields/buttons stack (matches
 *               Figma "Field+CTAs" gap)
 *     footer    8px (spacing-02) — auxiliary links
 */
@customElement("zl-card")
export class ZlCard extends LitElement {
  static override styles = [baseHostStyles, ...surfaceStyles(cardHost, cardSurface)];

  @property({ type: Boolean, reflect: true }) accessor compact = false;

  @state() accessor hasHeaderSlot = false;

  @state() accessor hasFooterSlot = false;

  private headerSlot?: HTMLSlotElement;

  private footerSlot?: HTMLSlotElement;

  override firstUpdated(): void {
    const root = this.shadowRoot;
    if (!root) return;

    this.headerSlot = root.querySelector('slot[name="header"]') ?? undefined;
    this.footerSlot = root.querySelector('slot[name="footer"]') ?? undefined;
    this.headerSlot?.addEventListener("slotchange", this.syncSlotPresence);
    this.footerSlot?.addEventListener("slotchange", this.syncSlotPresence);
    this.syncSlotPresence();
  }

  override updated(): void {
    this.syncSlotPresence();
  }

  private syncSlotPresence = (): void => {
    const hasHeader =
      this.headerSlot instanceof HTMLSlotElement &&
      this.headerSlot.assignedElements({ flatten: true }).length > 0;
    const hasFooter =
      this.footerSlot instanceof HTMLSlotElement &&
      this.footerSlot.assignedElements({ flatten: true }).length > 0;
    if (hasHeader !== this.hasHeaderSlot) this.hasHeaderSlot = hasHeader;
    if (hasFooter !== this.hasFooterSlot) this.hasFooterSlot = hasFooter;
  };

  override render() {
    const cardClass = this.compact ? "zr-card zr-card--compact" : "zr-card";
    const headerClass = this.hasHeaderSlot ? "zr-card__header" : "zr-card__header zr-card__region--empty";
    const footerClass = this.hasFooterSlot ? "zr-card__footer" : "zr-card__footer zr-card__region--empty";
    return html`
      <section class=${cardClass} part="card">
        <header class=${headerClass} part="header">
          <slot name="header"></slot>
        </header>
        <div class="zr-card__body" part="body">
          <slot></slot>
        </div>
        <footer class=${footerClass} part="footer">
          <slot name="footer"></slot>
        </footer>
      </section>
    `;
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
