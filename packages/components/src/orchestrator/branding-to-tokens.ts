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
 */
import type { ResolvedTheme } from "./theme-controller.js";
import type { Branding, BrandingPalette, BrandingShape, BrandingTypography } from "./branding.js";

const RADIUS_MAP: Record<NonNullable<BrandingShape["radius"]>, string> = {
  none: "0",
  sm: "0.25rem",
  md: "0.5rem",
  lg: "0.75rem",
  full: "9999px",
};

const DENSITY_MAP: Record<NonNullable<BrandingShape["density"]>, Record<string, string>> = {
  compact: {
    "--zl-control-height-sm": "1.75rem",
    "--zl-control-height-md": "2.25rem",
    "--zl-control-height-lg": "2.75rem",
    "--zl-space-3": "0.5rem",
    "--zl-space-5": "1rem",
  },
  regular: {},
  comfortable: {
    "--zl-control-height-sm": "2.25rem",
    "--zl-control-height-md": "2.75rem",
    "--zl-control-height-lg": "3.25rem",
    "--zl-space-3": "1rem",
    "--zl-space-5": "1.5rem",
  },
};

const PALETTE_MAP: Record<keyof BrandingPalette, string> = {
  primary: "--zl-color-primary",
  on_primary: "--zl-color-on-primary",
  background: "--zl-color-background",
  surface: "--zl-color-surface",
  muted: "--zl-color-muted",
  border: "--zl-color-border",
  text: "--zl-color-text",
  text_muted: "--zl-color-text-muted",
  link: "--zl-color-link",
  success: "--zl-color-success",
  warning: "--zl-color-warning",
  error: "--zl-color-error",
};

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
    blocks.push(formatBlock(":host", lightDecls));
  }
  if (Object.keys(darkDecls).length > 0) {
    blocks.push(formatBlock(':host([data-theme="dark"])', darkDecls));
  }

  // When the orchestrator forces dark mode (mode: "dark" or auto + prefers-dark),
  // treat the dark overrides as primary so :host alone reflects dark even
  // before a `data-theme` attribute is set. Cheap and avoids a flash.
  if (options.resolvedTheme === "dark" && darkPalette) {
    const merged = { ...lightDecls, ...darkDecls };
    blocks.length = 0;
    blocks.push(formatBlock(":host", merged));
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
  for (const [key, varName] of Object.entries(PALETTE_MAP) as [keyof BrandingPalette, string][]) {
    const value = palette[key];
    if (typeof value === "string" && value.length > 0) {
      out[varName] = value;
    }
  }
  return out;
}

function mapTypography(typography: BrandingTypography | undefined): Record<string, string> {
  if (!typography) return {};
  const out: Record<string, string> = {};
  if (typography.font_family) {
    out["--zl-font-family"] = typography.font_family;
  }
  if (typography.font_family_mono) {
    out["--zl-font-family-mono"] = typography.font_family_mono;
  }
  const scale = clamp(typography.scale ?? 1, 0.75, 1.25);
  if (scale !== 1) {
    out["--zl-font-size-xs"] = `${0.75 * scale}rem`;
    out["--zl-font-size-sm"] = `${0.875 * scale}rem`;
    out["--zl-font-size-md"] = `${1 * scale}rem`;
    out["--zl-font-size-lg"] = `${1.125 * scale}rem`;
    out["--zl-font-size-xl"] = `${1.5 * scale}rem`;
  }
  return out;
}

function mapShape(shape: BrandingShape | undefined): Record<string, string> {
  if (!shape) return {};
  const out: Record<string, string> = {};
  if (shape.radius && RADIUS_MAP[shape.radius]) {
    const radius = RADIUS_MAP[shape.radius];
    out["--zl-radius-md"] = radius;
    out["--zl-radius-sm"] = radius === "0" ? "0" : `calc(${radius} * 0.5)`;
    out["--zl-radius-lg"] = radius === "0" ? "0" : `calc(${radius} * 1.5)`;
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

/**
 * Apply a branding payload as the only `adoptedStyleSheet` token layer on a
 * `ShadowRoot`. Subsequent calls replace the previous sheet so a new branding
 * payload paints cleanly without leaking older declarations.
 *
 * Returns the resolved theme used so the caller can also reflect it on the
 * host's `data-theme` attribute.
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
  // Keep any non-token sheets that the host may have set; replace only the
  // token sheet that we own.
  const previous = (shadowRoot as ShadowRoot & { __zlTokenSheet?: CSSStyleSheet }).__zlTokenSheet;
  const others = shadowRoot.adoptedStyleSheets.filter((s) => s !== previous);
  shadowRoot.adoptedStyleSheets = [...others, sheet];
  (shadowRoot as ShadowRoot & { __zlTokenSheet?: CSSStyleSheet }).__zlTokenSheet = sheet;
}

export function resolveTheme(branding: Branding | undefined): ResolvedTheme {
  const mode = branding?.theme?.mode ?? "light";
  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  if (typeof matchMedia === "function") {
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}
