import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";

import iconStyles from "./zl-icon.css?inline";
import {
  ArrowLeft,
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
 * The Figma design system (file `8UjCXw8yemgljmbkWGrSfE`, Icons set
 * `4103:10466`, sizes `16 | 24`) is explicitly built on Lucide. Rather than redrawing every glyph as an
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
    return html`
      <span class=${classes}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
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
  | "eye-off";

/** Auth-surface glyph list — keep playgrounds and parity tests in sync. */
export const SHIPPED_ICON_NAMES = [
  "plus",
  "arrow-right",
  "arrow-left",
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
] as const satisfies readonly IconName[];

export type IconSize = "16" | "24";

export type IconTone = "default" | "error" | "success" | "disabled";

/** Curated mapping from our public name to a Lucide canonical icon. */
const ICON_NODES: Record<IconName, IconNode> = {
  plus: Plus,
  "arrow-right": ArrowRight,
  "arrow-left": ArrowLeft,
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
const ICON_MARKUP: Record<IconName, string> = Object.fromEntries(
  (Object.entries(ICON_NODES) as Array<[IconName, IconNode]>).map(([name, node]) => [
    name,
    nodeToSvgMarkup(node),
  ]),
) as Record<IconName, string>;

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
