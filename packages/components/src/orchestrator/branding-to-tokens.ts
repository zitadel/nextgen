/**
 * Branding -> CSS token bridge.
 *
 * Per `docs/design/branding/README.md` the orchestrator owns theming. Templates
 * never emit `<style>` blocks; they only structure HTML. This module translates
 * the `Branding` JSON into a CSSStyleSheet of `:host { --zl-* }` declarations
 * and applies it via `shadowRoot.adoptedStyleSheets`.
 *
 * Dark-mode overrides are emitted as `:host([data-theme="dark"]) { ... }`
 * (matching `docs/design/branding/tokens.md`). Resolution between
 * `light | dark | auto` happens in `<zitadel-login>`.
 *
 * Base layer: the design-tokens package ships the full `--zl-*` set as both a
 * `.css` file (for host pages) and a `tokensCss` string (for shadow roots and
 * SSR). We adopt the string into every orchestrator shadow root so atoms
 * paint correctly even when the host page didn't `@import` tokens.css — the
 * orchestrator is meant to drop into any page.
 */
import { THEME_SELECTORS, tokensCss } from "@zitadel/design-tokens";

import type { ResolvedTheme } from "./theme-controller.js";
import type { Branding, BrandingPalette, BrandingShape, BrandingTypography } from "./branding.js";

// Radius tokens (Figma corner-radius scale). Branding lets a tenant pick
// one of five shapes; we override all three corner sizes in proportion.
const RADIUS_MAP: Record<NonNullable<BrandingShape["radius"]>, string> = {
  none: "0",
  sm: "0.25rem",
  md: "0.5rem",
  lg: "0.75rem",
  full: "9999px",
};

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

/** Dark-only overrides. Emitted after {@link BRANDING_SELECTOR}, so it wins on order. */
const DARK_SELECTOR = ':host([data-theme="dark"])';

export type BrandingToTokensOptions = {
  resolvedTheme?: ResolvedTheme;
};

/**
 * Build a CSS string of `:host { --zl-* }` declarations from a Branding
 * payload. Light values land on `:host`; dark overrides land on
 * `:host([data-theme="dark"])`.
 */
export function buildBrandingStylesheet(
  branding: Branding | undefined,
  options: BrandingToTokensOptions = {},
): string {
  const lightDecls = collectDeclarations(branding);
  const darkPalette = branding?.theme?.dark?.palette;
  const darkDecls = darkPalette ? mapPalette(darkPalette) : {};

  const blocks: string[] = [];
  if (Object.keys(lightDecls).length > 0) {
    blocks.push(formatBlock(BRANDING_SELECTOR, lightDecls));
  }
  if (Object.keys(darkDecls).length > 0) {
    blocks.push(formatBlock(DARK_SELECTOR, darkDecls));
  }

  // When the orchestrator forces dark mode (mode: "dark" or auto + prefers-dark),
  // treat the dark overrides as primary so the element reflects dark even
  // before a `data-theme` attribute is set. Cheap and avoids a flash.
  if (options.resolvedTheme === "dark" && darkPalette) {
    const merged = { ...lightDecls, ...darkDecls };
    blocks.length = 0;
    blocks.push(formatBlock(BRANDING_SELECTOR, merged));
  }

  return blocks.join("\n");
}

function collectDeclarations(branding: Branding | undefined): Record<string, string> {
  if (!branding) {
    return {};
  }
  const decls: Record<string, string> = {};
  Object.assign(decls, mapPalette(branding.palette));
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
  // `font_family` sets both faces, which is the single-font look most brands
  // want. `font_family_heading` peels the display face back off — name it and
  // the body font stops dictating what titles render in.
  if (typography.font_family) {
    out["--zl-font-family-sans"] = typography.font_family;
    out["--zl-font-family-heading"] = typography.font_family;
  }
  if (typography.font_family_heading) {
    out["--zl-font-family-heading"] = typography.font_family_heading;
  }
  if (typography.font_family_mono) {
    out["--zl-font-family-mono"] = typography.font_family_mono;
  }
  // Typography scale tunes the *base* font sizes embedded in atoms.
  // The Figma scale isn't published as variables, so we map to the
  // implicit sizes the atoms use directly.
  const scale = clamp(typography.scale ?? 1, 0.75, 1.25);
  if (scale !== 1) {
    out["--zl-font-scale"] = `${scale}`;
  }
  return out;
}

function mapShape(shape: BrandingShape | undefined): Record<string, string> {
  if (!shape) return {};
  const out: Record<string, string> = {};
  if (shape.radius && RADIUS_MAP[shape.radius]) {
    const radius = RADIUS_MAP[shape.radius];
    // The three steps the atoms actually draw with: `md` for controls (inputs,
    // buttons), `lg` for the alert, `xl` for the card. Scaling them off one
    // tenant value keeps their relative proportions when a brand asks for
    // sharper or rounder corners. Smaller and larger steps stay untouched.
    out["--zl-radius-md"] = radius;
    out["--zl-radius-lg"] = radius === "0" ? "0" : `calc(${radius} * 1.25)`;
    out["--zl-radius-xl"] = radius === "0" ? "0" : `calc(${radius} * 1.75)`;
  }
  if (shape.density) {
    Object.assign(out, DENSITY_MAP[shape.density]);
  }
  return out;
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
 * hosted login page renders when a tenant states no preference.
 */
export function resolveTheme(branding: Branding | undefined): ResolvedTheme {
  const mode = branding?.theme?.mode ?? "dark";
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  if (typeof matchMedia === "function") {
    return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return "dark";
}
