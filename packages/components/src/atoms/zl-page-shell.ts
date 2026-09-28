import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

import pageShellStyles from "./zl-page-shell.css?inline";

import type { AtomManifest } from "../manifest.js";
import { baseHostStyles, surfaceStyles } from "../styles/index.js";

/**
 * Atom: `<zl-page-shell>` — the full-bleed auth-page chrome the
 * orchestrator injects around every flow template. Responsible for the
 * dark background, vertical centring, responsive padding, and footer
 * attribution slot.
 *
 * Figma values, from the sign-in / sign-up / passkey-upsell frames:
 *
 *   background  --zl-background
 *   color       --zl-foreground, inherited
 *   min-height  100vh — anchors the trustmark to the viewport bottom even
 *               behind a short card
 *   padding     40px at the desktop frame (1280 wide), 24px below 48rem —
 *               the mobile frame is 360 wide around a 312 card
 *   gap         24px between header / main / footer slots (card → trustmark)
 *
 * All of the above is page chrome. In widget mode (`data-widget`, stamped
 * by the orchestrators whenever their `variant` is not `page`) the shell
 * sheds it entirely — background, viewport min-height, AND the responsive
 * padding — leaving a transparent, content-sized pass-through: the
 * embedding app owns spacing around the card. Only the region gap
 * survives, because it separates real content (card → attribution pill).
 */
@customElement("zl-page-shell")
export class ZlPageShell extends LitElement {
  static override styles = [
    baseHostStyles,
    ...surfaceStyles(pageShellStyles),
  ];

  override render() {
    const hasHeader = this.lightDomSlotFilled("header");
    const hasFooter = this.lightDomSlotFilled("footer");
    const headerClass = hasHeader
      ? "zr-page-shell__header"
      : "zr-page-shell__header zr-page-shell__region--empty";
    const footerClass = hasFooter
      ? "zr-page-shell__footer"
      : "zr-page-shell__footer zr-page-shell__region--empty";
    return html`
      <div class="zr-page-shell" part="shell">
        <header class=${headerClass} part="header">
          <slot name="header" @slotchange=${this.onSlotChange}></slot>
        </header>
        <main class="zr-page-shell__main" part="main">
          <slot></slot>
        </main>
        <footer class=${footerClass} part="footer">
          <slot name="footer" @slotchange=${this.onSlotChange}></slot>
        </footer>
      </div>
    `;
  }

  /**
   * Re-render when a named slot's assignment changes so a footer/header added
   * after first paint updates the empty-region class. The initial render reads
   * children synchronously (no empty-then-filled flash).
   */
  private onSlotChange = (): void => {
    this.requestUpdate();
  };

  private lightDomSlotFilled(slot: string): boolean {
    for (const child of this.children) {
      if (child.getAttribute("slot") === slot) return true;
    }
    return false;
  }
}

export const zlPageShellManifest: AtomManifest = {
  tag: "zl-page-shell",
  attrs: [],
  parts: ["shell", "header", "main", "footer"],
  slots: ["", "header", "footer"],
  events: [],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-page-shell": ZlPageShell;
  }
}
