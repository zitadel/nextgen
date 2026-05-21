import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

import pillHost from "@zitadel-nextgen/shared-component-styles/lit/pill-host.css?inline";
import pillSurface from "@zitadel-nextgen/shared-component-styles/pill.css?inline";

import type { AtomManifest } from "../manifest.js";
import { baseHostStyles, surfaceStyles } from "../styles/index.js";

/**
 * Atom: `<zl-pill>` — small inline chip used for status and attribution.
 *
 * Spec lineage (file `xkvBjkOJ8ENuHdTGZHXezK`):
 *   - canonical instance: node `6593:141767` ("Social media" frame =
 *     "Secured with Zitadel" attribution pill on every sign-in screen).
 *
 * Two roles in scope:
 *   - **Attribution pill** ("Secured with Zitadel") rendered by the
 *     orchestrator footer when `branding.attribution` is enabled. This is
 *     the only canonical pill in the Figma screens; its spec is the
 *     source of truth for every dimension.
 *   - **Status pill** (decorative `tone` variants — pink / purple /
 *     orange / success) reuses the same geometry and typography, only
 *     swapping the tint colour. The tones don't have screen instances in
 *     Figma yet; when they ship, re-verify each tone against its master.
 *
 * Per-state Figma values (from node `6593:141767`):
 *
 *   surface     bg layered linear-gradient(182deg,
 *                 rgba(72,74,87,0.6) 28.65%,
 *                 rgba(15,15,17,0.6) 81.82%)
 *                 over surface.default-primary-gray (#252528)
   *   border      1px solid #484a57 (our token: border.default-gray-200 —
   *                 Figma calls this "default-gray-100"; our gray primitive
   *                 ladder is offset by one slot, so map to gray-200)
 *   radius      100px (full pill)
 *   size        186×40px frame (`get_metadata` on `6593:141767`)
 *   padding     16px inline (spacing-03) / 10px block (spacing metadata:
 *                 text y=10, line 20px, frame height 40px)
 *   gap         8px (spacing-02)
 *   font        Arimo Regular 14/20, letter-spacing 0, color
 *               text.primary-white (#f4f4f6), text-transform none
 *   focus-vis   2px solid focus.color, offset 2px
 *
 *   content     "Secured with" + 65×16 logotype SVG (`attribution-markup.ts`);
 *               logotype `margin-top: 2px` (Figma text y=10, logotype y=12)
 */
@customElement("zl-pill")
export class ZlPill extends LitElement {
  static override styles = [baseHostStyles, ...surfaceStyles(pillHost, pillSurface)];

  @property() accessor tone: "neutral" | "pink" | "purple" | "orange" | "success" = "neutral";

  @property() accessor href: string | undefined = undefined;

  @property({ attribute: "aria-label" })
  override accessor ariaLabel: string | null = null;

  private surfaceClasses(): string {
    return ["zr-pill", this.tone !== "neutral" ? `zr-pill--${this.tone}` : ""].filter(Boolean).join(" ");
  }

  override render() {
    const classes = this.surfaceClasses();
    if (this.href) {
      return html`<a
        class=${classes}
        part="pill"
        href=${this.href}
        rel="noopener"
        aria-label=${this.ariaLabel ?? nothing}
      ><slot></slot></a>`;
    }
    return html`<span class=${classes} part="pill"><slot></slot></span>`;
  }
}

export const zlPillManifest: AtomManifest = {
  tag: "zl-pill",
  attrs: ["tone", "href", "aria-label"],
  parts: ["pill"],
  slots: [],
  events: [],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-pill": ZlPill;
  }
}
