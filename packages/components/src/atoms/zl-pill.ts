import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import pillStyles from "./zl-pill.css?inline";

import type { AtomManifest } from "../manifest.js";
import { baseHostStyles, surfaceStyles } from "../styles/index.js";

/**
 * Atom: `<zl-pill>` — the shadcn `Badge`, used for status and for the session
 * chip in the trustmark.
 *
 * Figma values:
 *
 *   height      20px, with the 1px border inside it — left to hug, the same
 *               padding and line-height render 22px
 *   padding     8px inline, 2px block
 *   radius      full
 *   gap         4px
 *   font        14/20 at `--zl-font-weight-medium`
 *   surface     `--zl-secondary` / `--zl-secondary-foreground`
 *
 * The gradient sheen and 40px height it used to carry belonged to the old
 * attribution pill, which the trustmark no longer wraps in a chip: "Secured
 * with" and the logotype are plain text beside the badge now.
 *
 * `tone` follows the Badge's variants. The decorative pink / purple / orange
 * tints are gone: they had no instance in any frame and were the last
 * consumers of the retired `--zl-color-text-subtitle-*` tokens.
 */
@customElement("zl-pill")
export class ZlPill extends LitElement {
  static override styles = [baseHostStyles, ...surfaceStyles(pillStyles)];

  @property() accessor tone: "neutral" | "outline" | "success" | "error" = "neutral";

  @property() accessor href: string | undefined = undefined;

  @property({ attribute: "aria-label" })
  override accessor ariaLabel: string | null = null;

  override render() {
    const classes = classMap({
      "zr-pill": true,
      [`zr-pill--${this.tone}`]: this.tone !== "neutral",
    });
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
  slots: [""],
  events: [],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-pill": ZlPill;
  }
}
