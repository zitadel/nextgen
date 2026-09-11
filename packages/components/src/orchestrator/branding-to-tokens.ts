/**
 * Branding -> CSS token bridge.
 *
 * Per `docs/design/branding/README.md` the orchestrator owns theming. Templates
 * never emit `<style>` blocks; they only structure HTML. This module translates
 * the `Branding` JSON into a CSSStyleSheet of `:host { --zl-* }` declarations
 * and applies it via `shadowRoot.adoptedStyleSheets`.
 *
 * Light and dark are independent surfaces: each side's palette is emitted under
 * its own `data-theme` selector only, so a key the revision left unset on one
 * side takes the maintained default for that side rather than the other side's
 * colour. Resolution between `light | dark | auto` happens in `<zitadel-login>`.
 *
 * Base layer: the design-tokens package ships the full `--zl-*` set as both a
 * `.css` file (for host pages) and a `tokensCss` string (for shadow roots and
 * SSR). We adopt the string into every orchestrator shadow root so atoms
 * paint correctly even when the host page didn't `@import` tokens.css — the
 * orchestrator is meant to drop into any page.
 */
import { THEME_SELECTORS, tokens, tokensCss } from "@zitadel/design-tokens";

import { publishedSides } from "./branding.js";
import type { Branding, BrandingPalette, BrandingShape, BrandingTypography } from "./branding.js";
import type { ResolvedTheme } from "./theme-controller.js";

// The corner ramp a brand's single radius value scales. Ratios come from the
// design system's own steps rather than being spelled out, so a change to the
// ramp in Figma moves the branded corners with it.
const RADIUS_STEPS = ["xs", "sm", "md", "lg", "xl"] as const;

const RADIUS_RATIOS: Record<(typeof RADIUS_STEPS)[number], number> = (() => {
  const base = remToNumber(tokens.radius.md);
  const ratios = {} as Record<(typeof RADIUS_STEPS)[number], number>;
  for (const step of RADIUS_STEPS) {
    ratios[step] = remToNumber(tokens.radius[step]) / base;
  }
  return ratios;
})();

// Preset names, as rem values for the control step (`md`). The pill is its own
// case: every step goes fully round, so it has no control value to scale from.
const RADIUS_PRESETS = {
  none: 0,
  sm: 0.25,
  md: 0.5,
  lg: 0.75,
} as const;

// The text steps the login surface draws with. `typography.scale` multiplies
// both the size and its leading, so a brand that asks for larger text gets the
// line box that goes with it rather than crowded lines.
const TEXT_STEPS = ["xs", "sm", "base", "lg", "xl"] as const;

// Branding lets tenants tune perceived density. Padding bands are the
// most visible knob; height tweaks come from the Figma button/field heights.
const DENSITY_MAP: Record<NonNullable<BrandingShape["density"]>, Record<string, string>> = {
  compact: {
    "--zl-spacing-4": "0.75rem",
    "--zl-spacing-8": "1.5rem",
  },
  regular: {},
  comfortable: {
    "--zl-spacing-4": "1.25rem",
    "--zl-spacing-8": "2.25rem",
  },
};

// Mapping from the Branding palette keys (stable, public API for tenants) to
// the design-tokens variable names that atoms actually consume. The keys are
// intentionally semantic — tenants do NOT see internal token names; they say
// "background", "surface", "primary", "text". The orchestrator translates here,
// which is what lets the internal vocabulary move (as it just did, off the
// legacy `--zl-color-*` names onto the shadcn roles) without touching a single
// tenant's `branding.json`.
//
// A key maps to more than one variable where the design system splits a role
// the tenant-facing API deliberately does not: a brand picks one "border"
// colour, and both the card edge and the control edge take it.
const PALETTE_MAP: Record<keyof BrandingPalette, string[]> = {
  primary: ["--zl-primary"],
  on_primary: ["--zl-primary-foreground"],
  background: ["--zl-background"],
  surface: ["--zl-card", "--zl-popover"],
  muted: ["--zl-muted", "--zl-secondary", "--zl-accent"],
  border: ["--zl-border", "--zl-input"],
  // Every neutral surface's text, not just the page's. A brand that sets a
  // light `muted` on a dark-resolving widget would otherwise keep the default
  // near-white label on it — the secondary button rendered at 1.05:1.
  text: [
    "--zl-foreground",
    "--zl-card-foreground",
    "--zl-popover-foreground",
    "--zl-secondary-foreground",
    "--zl-accent-foreground",
  ],
  text_muted: ["--zl-muted-foreground"],
  // The frames draw links in the surrounding text colour and distinguish them
  // by an underline, so `--zl-link` defaults to `currentColor`. Setting it here
  // (or from a host page) tints exactly the links — the card-nav switcher and
  // the forgot-password affordance — and nothing else.
  link: ["--zl-link"],
  success: ["--zl-success"],
  warning: ["--zl-warning"],
  error: ["--zl-destructive"],
};

/**
 * Selector for the tenant's declarations.
 *
 * It names the theme attributes rather than relying on `:host` alone, so it
 * reaches the same specificity as the base token layer. `applyBaseTokens`
 * rewrites the design-system defaults onto `:host, :host([data-theme="dark"])`,
 * so on a host carrying `data-theme` — which `applySurfaceTheme` always stamps
 * — the *default* matches at `(0,2,0)`. A plain `:host` block is `(0,1,0)` and
 * loses on specificity however much later it is adopted, which left every
 * tenant's palette, fonts and shape painting nothing.
 *
 * Matching the attribute makes both `(0,2,0)`, so adoption order decides and
 * branding — adopted after the base — wins. `:host` stays in the list to cover
 * the moment before a theme resolves.
 */
const BRANDING_SELECTOR = ':host, :host([data-theme="light"]), :host([data-theme="dark"])';

/** Per-side palettes. Emitted after {@link BRANDING_SELECTOR}, so they win on order. */
const LIGHT_SELECTOR = ':host([data-theme="light"])';
const DARK_SELECTOR = ':host([data-theme="dark"])';

export type BrandingToTokensOptions = {
  resolvedTheme?: ResolvedTheme;
};

/**
 * Build a CSS string of `:host { --zl-* }` declarations from a Branding
 * payload. Shape and typography are shared across the sides; each side's
 * palette lands only under its own `data-theme` selector, plus a copy of the
 * resolved side on the shared selector so the surface is already branded in the
 * frame before `data-theme` is stamped.
 */
export function buildBrandingStylesheet(
  branding: Branding | undefined,
  options: BrandingToTokensOptions = {},
): string {
  const shared = collectDeclarations(branding);
  const light = mapPalette(branding?.theme?.light?.palette);
  const dark = mapPalette(branding?.theme?.dark?.palette);
  // Without a resolved theme, a revision that publishes one side is already
  // unambiguous; only a two-sided one has to guess, and the design system's
  // primary surface is dark.
  const [only, second] = publishedSides(branding);
  const side = options.resolvedTheme ?? (only && !second ? only : "dark");
  const resolved = side === "light" ? light : dark;

  const blocks: string[] = [];
  const upfront = { ...shared, ...resolved };
  if (Object.keys(upfront).length > 0) {
    blocks.push(formatBlock(BRANDING_SELECTOR, upfront));
  }
  if (Object.keys(light).length > 0) {
    blocks.push(formatBlock(LIGHT_SELECTOR, light));
  }
  if (Object.keys(dark).length > 0) {
    blocks.push(formatBlock(DARK_SELECTOR, dark));
  }

  return blocks.join("\n");
}

function collectDeclarations(branding: Branding | undefined): Record<string, string> {
  if (!branding) {
    return {};
  }
  const decls: Record<string, string> = {};
  Object.assign(decls, mapTypography(branding.typography));
  Object.assign(decls, mapShape(branding.shape));
  return decls;
}

function mapPalette(palette: BrandingPalette | undefined): Record<string, string> {
  if (!palette) return {};
  const out: Record<string, string> = {};
  for (const [key, varNames] of Object.entries(PALETTE_MAP) as [keyof BrandingPalette, string[]][]) {
    const value = palette[key];
    if (typeof value === "string" && value.length > 0) {
      for (const varName of varNames) {
        out[varName] = value;
      }
    }
  }
  return out;
}

function mapTypography(typography: BrandingTypography | undefined): Record<string, string> {
  if (!typography) return {};
  const out: Record<string, string> = {};
  // One face covers body and headings. A separate display face is not part of
  // a branding revision: a host page that has licensed one declares the
  // `@font-face` and points `--zl-font-family-heading` at it.
  if (typography.font_family) {
    out["--zl-font-family-sans"] = typography.font_family;
    out["--zl-font-family-heading"] = typography.font_family;
  }
  const scale = clamp(typography.scale ?? 1, 0.75, 1.25);
  if (scale !== 1) {
    for (const step of TEXT_STEPS) {
      out[`--zl-text-${step}-size`] = scaleRem(tokens.text[step].size, scale);
      out[`--zl-text-${step}-leading`] = scaleRem(tokens.text[step].leading, scale);
    }
  }
  return out;
}

function mapShape(shape: BrandingShape | undefined): Record<string, string> {
  if (!shape) return {};
  const out: Record<string, string> = {};
  Object.assign(out, mapRadius(shape.radius));
  if (shape.density) {
    Object.assign(out, DENSITY_MAP[shape.density]);
  }
  // The caps themselves stay in the CSS that draws the mark; branding supplies
  // the multiplier so a host override of a cap keeps working underneath it.
  const logoScale = shape.logo_scale;
  if (typeof logoScale === "number" && Number.isFinite(logoScale)) {
    out["--zl-logo-scale"] = `${clamp(logoScale, 0.5, 2)}`;
  }
  return out;
}

/**
 * A brand picks one corner value and the whole ramp follows it in proportion,
 * which is what keeps the card rounder than the controls inside it. Both forms
 * the revision accepts land here: a preset name, or an integer number of pixels
 * for the brand that has a specific value.
 */
function mapRadius(radius: BrandingShape["radius"]): Record<string, string> {
  if (radius == null) return {};
  const out: Record<string, string> = {};
  if (radius === "full") {
    // A pill has no ramp: every corner is fully round, and scaling 9999px would
    // only produce a larger number that draws the same shape.
    for (const step of RADIUS_STEPS) {
      out[`--zl-radius-${step}`] = tokens.radius.full;
    }
    return out;
  }
  const [base, unit] =
    typeof radius === "number"
      ? [radius, "px"]
      : radius in RADIUS_PRESETS
        ? [RADIUS_PRESETS[radius as keyof typeof RADIUS_PRESETS], "rem"]
        : [Number.NaN, ""];
  if (Number.isNaN(base)) return {};
  for (const step of RADIUS_STEPS) {
    const value = base * RADIUS_RATIOS[step];
    out[`--zl-radius-${step}`] = value === 0 ? "0" : `${round(value)}${unit}`;
  }
  return out;
}

function scaleRem(value: string, scale: number): string {
  return `${round(remToNumber(value) * scale)}rem`;
}

function remToNumber(value: string): number {
  return Number.parseFloat(value);
}

// Four decimals keeps a scaled step exact enough to be indistinguishable at any
// realistic text size while staying a readable value in devtools.
function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function formatBlock(selector: string, decls: Record<string, string>): string {
  const lines = Object.entries(decls).map(([prop, value]) => `  ${prop}: ${value};`);
  return `${selector} {\n${lines.join("\n")}\n}`;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// Lazily-built base sheet, shared by every `<zitadel-login>` instance.
// `tokensCss` ships the design-system defaults against document selectors;
// rewriting them to `:host` projects the same variables onto the orchestrator's
// shadow root so `var(--zl-*)` lookups inside atoms resolve before branding
// overrides land. The selectors come from the package rather than being spelled
// out here: a mismatch would not fail, it would silently stop rewriting and
// leave the widget with no base tokens at all.
let baseTokenSheet: CSSStyleSheet | undefined;
function getBaseTokenSheet(): CSSStyleSheet | undefined {
  if (typeof CSSStyleSheet === "undefined") return undefined;
  if (!baseTokenSheet) {
    const rewritten = tokensCss
      .replaceAll(THEME_SELECTORS.dark, ':host,\n:host([data-theme="dark"])')
      .replaceAll(THEME_SELECTORS.light, ':host([data-theme="light"])');
    baseTokenSheet = new CSSStyleSheet();
    baseTokenSheet.replaceSync(rewritten);
  }
  return baseTokenSheet;
}

/**
 * Adopt the design-system base token layer onto a `ShadowRoot`. Safe to call
 * many times — the underlying constructable sheet is shared across every
 * orchestrator instance and de-duplicated in the adopted list.
 */
export function applyBaseTokens(shadowRoot: ShadowRoot): void {
  const sheet = getBaseTokenSheet();
  if (!sheet) return;
  // jsdom partially implements `adoptedStyleSheets` — treat a non-array as empty.
  const existing: readonly CSSStyleSheet[] = Array.isArray(shadowRoot.adoptedStyleSheets)
    ? shadowRoot.adoptedStyleSheets
    : [];
  if (existing.includes(sheet)) return;
  try {
    shadowRoot.adoptedStyleSheets = [sheet, ...existing];
  } catch {
    // Environments without constructable stylesheet adoption.
  }
}

/**
 * Apply a branding payload as a `--zl-*` overrides layer on top of the base
 * token sheet. Subsequent calls replace the previous override sheet so a new
 * branding payload paints cleanly without leaking older declarations.
 *
 * Callers should run `applyBaseTokens(shadowRoot)` first (once per shadow
 * root) so the base values exist before branding patches them.
 */
export function applyBrandingTokens(
  shadowRoot: ShadowRoot,
  branding: Branding | undefined,
  resolvedTheme: ResolvedTheme,
): void {
  const css = buildBrandingStylesheet(branding, { resolvedTheme });
  if (typeof CSSStyleSheet === "undefined") {
    return;
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  // Replace only the branding override sheet we own; leave the base token
  // sheet and any host-supplied sheets in place.
  const previous = (shadowRoot as ShadowRoot & { __zlTokenSheet?: CSSStyleSheet }).__zlTokenSheet;
  const others = shadowRoot.adoptedStyleSheets.filter((s) => s !== previous);
  shadowRoot.adoptedStyleSheets = [...others, sheet];
  (shadowRoot as ShadowRoot & { __zlTokenSheet?: CSSStyleSheet }).__zlTokenSheet = sheet;
}

/**
 * Standalone branding→theme resolution for callers outside the orchestrator
 * (SSR, tests, embedders composing atoms by hand). `<zitadel-login>` itself
 * uses {@link ThemeController}, which layers the element's `theme` property
 * and a variant-derived fallback on top of the same branding input.
 *
 * Defaults to dark: the design system's primary surface, and the mode a
 * hosted login page renders when a revision states no preference.
 */
export function resolveTheme(branding: Branding | undefined): ResolvedTheme {
  const [only, second] = publishedSides(branding);
  // One published side is the whole surface: `auto` has nothing to choose
  // between, and an operating-system preference for the other side cannot
  // conjure colours the revision never published.
  if (only && !second) return only;
  const mode = branding?.theme?.mode ?? "dark";
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  if (typeof matchMedia === "function") {
    return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return "dark";
}
