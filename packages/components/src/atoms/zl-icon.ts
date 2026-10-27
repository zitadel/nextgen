import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";

import iconStyles from "./zl-icon.css?inline";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  Eye,
  EyeOff,
  type IconNode,
  Info,
  KeyRound,
  LoaderCircle,
  Plus,
  TriangleAlert,
  User,
  X,
} from "lucide";

import type { AtomManifest } from "../manifest.js";
import { surfaceStyles } from "../styles/index.js";

/**
 * Atom: `<zl-icon>` — renders a curated glyph from the Lucide icon library.
 *
 * The design system's icon set is explicitly built on Lucide, at 16 and 24px.
 * Rather than redrawing every glyph as an
 * inline `<path>` (which inevitably drifts), we curate the auth surface's
 * subset by importing each canonical Lucide node and exposing a stable
 * kebab-case `name` API. To add a glyph: import it from `lucide`, add an
 * entry to {@link ICON_NODES}, and extend the {@link IconName} union.
 *
 * Colour: by default the icon inherits `currentColor`, which is what most
 * usages want — the glyph takes the colour of the control it sits in. Set
 * `tone` to pick up `--zl-destructive`, `--zl-success` or
 * `--zl-muted-foreground` instead. Any other colour is a `color:` on the host.
 *
 * Brand marks (`brand-*`) are the exception to "everything comes from
 * Lucide": Lucide carries no vendor logos, and a provider's mark is fixed
 * artwork, so it is inlined in {@link BRAND_GLYPHS} with its own viewBox and
 * the wrapper drops the stroke styling the Lucide set needs. Adding one —
 * Microsoft, Apple — is an entry there plus a name in the union and in
 * {@link SHIPPED_BRAND_ICON_NAMES}.
 *
 * Not every vendor's mark is multi-coloured, and the wrapper already covers
 * both. The `<svg>` carries `fill="currentColor"`, so a monochrome mark —
 * GitHub, Apple — is added with no `fill` on its paths and follows the label
 * colour; a multi-coloured one — Google, Microsoft — states a fill per path
 * and overrides it. Neither needs a flag on the entry.
 *
 * Accessibility: glyphs with an entry in {@link DEFAULT_LABELS} expose an
 * `aria-label` so they're meaningful when used standalone. When the icon
 * is purely decorative (e.g. sitting next to a visible button label),
 * pass `decorative` to force `aria-hidden="true"` and `role="presentation"`,
 * which prevents the icon's name from leaking into the parent's
 * accessible name (e.g. avoids "Loading Loading" on a loading button).
 */
@customElement("zl-icon")
export class ZlIcon extends LitElement {
  /* No baseHostStyles — would force white on :host; icons inherit context color. */
  static override styles = surfaceStyles(iconStyles);

  @property() accessor name: IconName = "plus";

  @property({ reflect: true }) accessor size: IconSize = "24";

  @property({ reflect: true }) accessor tone: IconTone = "default";

  @property({ type: Boolean, reflect: true }) accessor spin = false;

  @property({ type: Boolean, reflect: true }) accessor decorative = false;

  @property() accessor label: string | undefined = undefined;

  override render() {
    const ariaLabel = this.label ?? DEFAULT_LABELS[this.name];
    const hidden = this.decorative || !ariaLabel;
    const classes = classMap({
      "zr-icon": true,
      [`zr-icon--${this.size}`]: true,
      [`zr-icon--tone-${this.tone}`]: this.tone !== "default",
      "zr-icon--spin": this.spin,
    });
    const brand = BRAND_GLYPHS[this.name as BrandIconName];
    // A brand mark paints itself: its own viewBox and no stroke, since the
    // Lucide styling would repaint it in the text colour. `fill` stays
    // `currentColor` so a monochrome mark follows the label; a multi-coloured
    // one states a fill per path and overrides it.
    return html`
      <span class=${classes}>
        <svg
          viewBox=${brand?.viewBox ?? "0 0 24 24"}
          fill=${brand ? "currentColor" : "none"}
          stroke=${brand ? nothing : "currentColor"}
          stroke-width=${brand ? nothing : "2"}
          stroke-linecap=${brand ? nothing : "round"}
          stroke-linejoin=${brand ? nothing : "round"}
          role=${hidden ? "presentation" : "img"}
          aria-hidden=${hidden ? "true" : "false"}
          aria-label=${hidden ? nothing : ariaLabel}
        >${unsafeSVG(ICON_MARKUP[this.name])}</svg>
      </span>
    `;
  }
}

/** Public, kebab-case glyph IDs. Add a new one by extending both this union and {@link ICON_NODES}. */
export type IconName =
  | "plus"
  | "arrow-right"
  | "arrow-left"
  | "arrow-left-right"
  | "spinner"
  | "check"
  | "chevron-down"
  | "cross"
  | "warning"
  | "alert-circle"
  | "info"
  | "passkey"
  | "user"
  | "eye"
  | "eye-off"
  | BrandIconName;

/**
 * Identity-provider brand marks, named `brand-<catalog template>` so a
 * connection's `template` maps to a glyph without a second lookup table.
 * A template with no mark here renders without one rather than with the
 * wrong one — see `<zl-sso-providers>`.
 */
export type BrandIconName = "brand-google" | "brand-github";

/** Auth-surface glyph list; every name maps to a glyph (zl-icon.spec.ts). */
export const SHIPPED_ICON_NAMES = [
  "plus",
  "arrow-right",
  "arrow-left",
  "arrow-left-right",
  "spinner",
  "check",
  "chevron-down",
  "cross",
  "warning",
  "alert-circle",
  "info",
  "passkey",
  "user",
  "eye",
  "eye-off",
  "brand-google",
  "brand-github",
] as const satisfies readonly IconName[];

/**
 * Brand marks only. `<zl-sso-providers>` reads this to decide whether a
 * connection's template has a mark of its own, so adding one here is what
 * makes a new vendor's button carry its logo.
 */
export const SHIPPED_BRAND_ICON_NAMES = [
  "brand-google",
  "brand-github",
] as const satisfies readonly BrandIconName[];

export type IconSize = "16" | "24";

export type IconTone = "default" | "error" | "success" | "disabled";

/** Curated mapping from our public name to a Lucide canonical icon. */
const ICON_NODES: Record<Exclude<IconName, BrandIconName>, IconNode> = {
  plus: Plus,
  "arrow-right": ArrowRight,
  "arrow-left": ArrowLeft,
  "arrow-left-right": ArrowLeftRight,
  spinner: LoaderCircle,
  check: Check,
  "chevron-down": ChevronDown,
  cross: X,
  warning: TriangleAlert,
  "alert-circle": CircleAlert,
  info: Info,
  passkey: KeyRound,
  user: User,
  eye: Eye,
  "eye-off": EyeOff,
};

/**
 * Vendor artwork, reproduced as each vendor publishes it: fixed geometry and
 * fixed colours, so it is inlined rather than derived. Each entry carries its
 * own viewBox because vendor marks are not drawn on Lucide's 24×24 grid.
 */
const BRAND_GLYPHS: Partial<Record<BrandIconName, { viewBox: string; markup: string }>> = {
  "brand-google": {
    viewBox: "0 0 48 48",
    markup: [
      '<path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/>',
      '<path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>',
      '<path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/>',
      '<path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/>',
    ].join(""),
  },
  // GitHub's mark (Primer Octicons `mark-github-16`, MIT). Monochrome, so
  // the path states no fill and follows the button's foreground in light and
  // dark mode.
  "brand-github": {
    viewBox: "0 0 16 16",
    markup:
      '<path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656"/>',
  },
};

const DEFAULT_LABELS: Partial<Record<IconName, string>> = {
  spinner: "Loading",
  warning: "Warning",
  "alert-circle": "Alert",
  info: "Information",
  passkey: "Passkey",
  user: "User",
  eye: "Show",
  "eye-off": "Hide",
};

// Pre-serialise the inner SVG markup once at module load so `render()` is
// cheap. Lucide's `IconNode` payloads are static module data, so caching
// the stringified output is safe and equivalent to inlining the source.
const ICON_MARKUP: Record<IconName, string> = {
  ...(Object.fromEntries(
    (Object.entries(ICON_NODES) as Array<[IconName, IconNode]>).map(([name, node]) => [
      name,
      nodeToSvgMarkup(node),
    ]),
  ) as Record<Exclude<IconName, BrandIconName>, string>),
  ...(Object.fromEntries(
    Object.entries(BRAND_GLYPHS).map(([name, glyph]) => [name, glyph.markup]),
  ) as Record<BrandIconName, string>),
};

function nodeToSvgMarkup(node: IconNode): string {
  return node
    .map(([tag, attrs]) => {
      const attrStr = Object.entries(attrs)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}="${String(value)}"`)
        .join(" ");
      return `<${tag} ${attrStr}/>`;
    })
    .join("");
}

export const zlIconManifest: AtomManifest = {
  tag: "zl-icon",
  attrs: ["name", "size", "tone", "spin", "decorative", "label"],
  parts: [],
  slots: [],
  events: [],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-icon": ZlIcon;
  }
}
