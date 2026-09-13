/**
 * Contrast checks for a branding revision's palettes.
 *
 * Advisory, not a gate. The server rejects a colour whose *form* is unsafe
 * (`branding-css.ts`); this reports a pair whose *result* is hard to read.
 * Publishing is not blocked on it: which pairs a surface actually renders
 * depends on the step, the text size, and the template, so a revision that
 * reads poorly is a judgement for the person publishing it rather than a
 * value the API can refuse.
 *
 * Every colour form the palette accepts is measured, `color-mix()` and
 * `currentColor` included (`css-color.ts`). A value that still cannot be
 * resolved comes back `unresolved`, so a caller says "not checked" rather than
 * implying a pass.
 *
 * Translucent values are composited before measuring: what a reader sees is
 * the blend, so a ratio against the raw value would describe a colour nobody
 * sees. A foreground composites over its own pair's surface; a translucent
 * surface composites over the side's `background`, which is what sits behind
 * the card. A translucent `background` has the host page behind it, which is
 * not ours to know — that pair stays unresolved.
 */

/** WCAG 2.2 AA: body text. */
export const CONTRAST_AA_TEXT = 4.5;
/** WCAG 2.2 AA: large text, and the boundary of a user-interface component. */
export const CONTRAST_AA_LARGE = 3;

import { compositeOver, parseCssColor, relativeLuminance, type Rgba } from "./css-color.js";

export type BrandingPaletteColors = Record<string, string | undefined>;

export type ContrastPair = {
  /** Palette key carrying the foreground colour. */
  foreground: string;
  /** Palette key carrying the surface it sits on. */
  background: string;
  /** The ratio this pair has to reach. */
  minimum: number;
  /** What the reader sees, for a message that names the thing rather than the key. */
  describes: string;
};

/**
 * The pairs a login surface actually puts next to each other. A palette key
 * appears more than once where the design system paints it on more than one
 * surface: `text` lands on both the page and the card, and a brand can pick a
 * background those two disagree about.
 */
export const BRANDING_CONTRAST_PAIRS: readonly ContrastPair[] = [
  { foreground: "text", background: "background", minimum: CONTRAST_AA_TEXT, describes: "body text on the page" },
  { foreground: "text", background: "surface", minimum: CONTRAST_AA_TEXT, describes: "body text on the card" },
  { foreground: "text_muted", background: "surface", minimum: CONTRAST_AA_TEXT, describes: "secondary text on the card" },
  { foreground: "on_primary", background: "primary", minimum: CONTRAST_AA_TEXT, describes: "the primary button's label" },
  { foreground: "link", background: "surface", minimum: CONTRAST_AA_TEXT, describes: "links on the card" },
  { foreground: "error", background: "surface", minimum: CONTRAST_AA_TEXT, describes: "error text on the card" },
  { foreground: "success", background: "surface", minimum: CONTRAST_AA_TEXT, describes: "success text on the card" },
  { foreground: "warning", background: "surface", minimum: CONTRAST_AA_TEXT, describes: "warning text on the card" },
  // The field outline is a component boundary, not text, so it takes the
  // lower bar — but it still has to be findable against the card it sits on.
  { foreground: "border", background: "surface", minimum: CONTRAST_AA_LARGE, describes: "the outline of inputs" },
];

export type ContrastFinding = ContrastPair & {
  status: "pass" | "fail" | "unresolved";
  /** Absent when the pair could not be measured. */
  ratio?: number;
};

/**
 * Contrast ratio between two colours, per WCAG 2.2. Order does not matter.
 * Both must be opaque: composite them first, since the ratio depends on what
 * a translucent value is sitting on.
 */
export function contrastRatio(a: string, b: string, context?: ContrastContext): number | undefined {
  const first = parseCssColor(a, context ?? {});
  const second = parseCssColor(b, context ?? {});
  if (!first || !second) return undefined;
  if (first.a < 1 || second.a < 1) return undefined;
  return ratioOf(first, second);
}

export type ContrastContext = { currentColor?: string };

function ratioOf(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check one side's palette. A pair whose colours are not both set is skipped
 * rather than reported: an omitted key takes the maintained default for that
 * side, which the design system already holds to this bar.
 */
export function checkPaletteContrast(palette: BrandingPaletteColors | undefined): ContrastFinding[] {
  if (!palette) return [];
  // `currentColor` on a palette key means the text colour it would inherit.
  // Everything the pairs below draw sits on the card, so that is the side's
  // own `text` — which is why this is answerable here and not in general CSS.
  const context = { currentColor: palette["text"] };
  const findings: ContrastFinding[] = [];
  for (const pair of BRANDING_CONTRAST_PAIRS) {
    const foreground = palette[pair.foreground];
    const background = palette[pair.background];
    if (!foreground || !background) continue;
    const resolved = resolvePair(foreground, background, palette, context);
    if (!resolved) {
      findings.push({ ...pair, status: "unresolved" });
      continue;
    }
    const ratio = ratioOf(resolved.foreground, resolved.background);
    findings.push({ ...pair, status: ratio >= pair.minimum ? "pass" : "fail", ratio });
  }
  return findings;
}

function resolvePair(
  foreground: string,
  background: string,
  palette: BrandingPaletteColors,
  context: ContrastContext,
): { foreground: Rgba; background: Rgba } | undefined {
  const fg = parseCssColor(foreground, context);
  let bg = parseCssColor(background, context);
  if (!fg || !bg) return undefined;
  if (bg.a < 1) {
    const behind = palette["background"];
    const page = behind ? parseCssColor(behind, context) : undefined;
    // The host page is behind the page background, and it is not ours to know.
    if (!page || page.a < 1) return undefined;
    bg = compositeOver(bg, page);
  }
  return { foreground: compositeOver(fg, bg), background: bg };
}

/** Both sides of a revision, keyed by the side each finding belongs to. */
export function checkBrandingContrast(branding: {
  theme?: { light?: { palette?: BrandingPaletteColors }; dark?: { palette?: BrandingPaletteColors } };
}): { light: ContrastFinding[]; dark: ContrastFinding[] } {
  return {
    light: checkPaletteContrast(branding.theme?.light?.palette),
    dark: checkPaletteContrast(branding.theme?.dark?.palette),
  };
}
