import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import pillStyles from "./zl-pill.css?inline";

import type { AtomManifest } from "../manifest.js";
import { baseHostStyles, sharedStyles, surfaceStyles } from "../styles/index.js";

/**
 * Atom: `<zl-pill>` — the shadcn `Badge`, used for status and for the session
 * chip in the trustmark.
 *
 * Values:
 *
 *   height      20px, with the 1px border inside it — left to hug, the same
 *               padding and line-height render 22px
 *   padding     8px inline, 2px block
 *   radius      full
 *   gap         4px
 *   font        `--zl-text-xs-*` at `--zl-font-weight-medium`
 *   surface     `--zl-secondary` / `--zl-secondary-foreground`
 *
 * `tone` follows the Badge's variants.
 */
@customElement("zl-pill")
export class ZlPill extends LitElement {
  static override styles = [baseHostStyles, ...surfaceStyles(sharedStyles, pillStyles)];

  @property() accessor tone: "neutral" | "outline" | "success" | "error" = "neutral";

  @property() accessor href: string | undefined = undefined;

  @property({ attribute: "aria-label" })
  override accessor ariaLabel: string | null = null;

  override render() {
    const classes = classMap({
      "zr-pill": true,
      "zr-focus-ring": true,
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
