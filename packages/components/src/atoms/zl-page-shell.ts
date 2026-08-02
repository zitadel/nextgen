import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

import pageShellHost from "@zitadel/shared-component-styles/lit/page-shell-host.css?inline";
import pageShellSurface from "@zitadel/shared-component-styles/page-shell.css?inline";

import type { AtomManifest } from "../manifest.js";
import { baseHostStyles, surfaceStyles } from "../styles/index.js";

/**
 * Atom: `<zl-page-shell>` — the full-bleed auth-page chrome the
 * orchestrator injects around every flow template. Responsible for the
 * dark background, vertical centring, responsive padding, and footer
 * attribution slot.
 *
 * Spec lineage (file `xkvBjkOJ8ENuHdTGZHXezK`):
 *   - 2xl frames (1536 × 960), e.g. sign-up `6593:141741`, passkey
 *     `6594:630`, signed-in `6596:132844`. The outer wrapper uses
 *     `py-[52px]` (vertical padding) with `p-[16px]` (spacing-03) on
 *     the inner Form container, giving 52px / 16px at 2xl.
 *
 * Per-state Figma values:
 *
 *   background  surface.default-black (#0f0f11)
 *   color       text.primary-white (#f4f4f6) inherited
 *   min-height  100vh — anchors footer to the viewport bottom even on
 *               short cards
 *   padding @md+   padding-block 52px, padding-inline 16px (matches
 *               Figma 2xl wrapper). 52px isn't a token; use raw value.
 *   padding @xs (< 48rem)
 *               padding-block 32px (spacing-05), padding-inline 16px
 *               (spacing-03) — tighter so the card breathes on
 *               narrow phones.
 *   gap         24px (spacing-04) between header / main / footer slots
 *   footer      min-height 1.5rem to reserve room for the attribution
 *               pill even when the slot is empty (prevents jitter).
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
    ...surfaceStyles(pageShellHost, pageShellSurface),
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
