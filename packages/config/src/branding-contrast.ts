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
 * sees. Each role composites over what is actually behind it — a button fill
 * over the card, the card over the page — rather than over the page in every
 * case. A translucent page has the host application behind it, which is not
 * ours to know, so that pair stays unresolved.
 */

/** WCAG 2.2 AA: body text. */
export const CONTRAST_AA_TEXT = 4.5;
/** WCAG 2.2 AA: large text, and the boundary of a user-interface component. */
export const CONTRAST_AA_LARGE = 3;

import { compositeOver, parseCssColor, relativeLuminance, type Rgba } from "./css-color.js";

export type BrandingPaletteColors = Record<string, string | undefined>;

export type ContrastPair = {
  /**
   * Stable join key, `foreground/background`. Downstream attaches a warning to
   * a row and counts issues per section by this id, so it must not change even
   * if the palette keys behind it are renamed.
   */
  id: string;
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
  { id: "text/background", foreground: "text", background: "background", minimum: CONTRAST_AA_TEXT, describes: "body text on the page" },
  { id: "text/surface", foreground: "text", background: "surface", minimum: CONTRAST_AA_TEXT, describes: "body text on the card" },
  { id: "text_muted/surface", foreground: "text_muted", background: "surface", minimum: CONTRAST_AA_TEXT, describes: "secondary text on the card" },
  // `muted` fills the secondary button and the alert, both of which draw text
  // on it — a palette can read perfectly on the card and be unreadable here.
  { id: "text/muted", foreground: "text", background: "muted", minimum: CONTRAST_AA_TEXT, describes: "the secondary button's label" },
  { id: "text_muted/muted", foreground: "text_muted", background: "muted", minimum: CONTRAST_AA_TEXT, describes: "supporting text in an alert" },
  { id: "on_primary/primary", foreground: "on_primary", background: "primary", minimum: CONTRAST_AA_TEXT, describes: "the primary button's label" },
  { id: "link/surface", foreground: "link", background: "surface", minimum: CONTRAST_AA_TEXT, describes: "links on the card" },
  { id: "error/surface", foreground: "error", background: "surface", minimum: CONTRAST_AA_TEXT, describes: "error text on the card" },
  { id: "success/surface", foreground: "success", background: "surface", minimum: CONTRAST_AA_TEXT, describes: "success text on the card" },
  { id: "warning/surface", foreground: "warning", background: "surface", minimum: CONTRAST_AA_TEXT, describes: "warning text on the card" },
  // The one pair that is not text. A field outline is a user-interface
  // component boundary, which WCAG 2.2 holds to 3:1 rather than 4.5:1 — an
  // input the visitor cannot find is a real failure, not decoration. Dropping
  // it would make `required` a constant, which is the only argument for
  // leaving it out.
  { id: "border/surface", foreground: "border", background: "surface", minimum: CONTRAST_AA_LARGE, describes: "the outline of inputs" },
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
    const resolved = resolvePair(foreground, pair.background, palette, context);
    if (!resolved) {
      findings.push({ ...pair, status: "unresolved" });
      continue;
    }
    const ratio = ratioOf(resolved.foreground, resolved.background);
    findings.push({ ...pair, status: ratio >= pair.minimum ? "pass" : "fail", ratio });
  }
  return findings;
}

/**
 * What sits behind each painted role. The card sits on the page; the button
 * and alert fills sit on the card. A role absent from this map is the page
 * itself, which has the host application behind it.
 */
const BACKDROP: Record<string, string> = {
  surface: "background",
  primary: "surface",
  muted: "surface",
};

function resolvePair(
  foregroundValue: string,
  backgroundRole: string,
  palette: BrandingPaletteColors,
  context: ContrastContext,
): { foreground: Rgba; background: Rgba } | undefined {
  const fg = parseCssColor(foregroundValue, context);
  const bg = resolveSurface(backgroundRole, palette, context, new Set());
  if (!fg || !bg) return undefined;
  return { foreground: compositeOver(fg, bg), background: bg };
}

/** Resolve a role to an opaque colour, compositing it down its own stack. */
function resolveSurface(
  role: string,
  palette: BrandingPaletteColors,
  context: ContrastContext,
  seen: Set<string>,
): Rgba | undefined {
  if (seen.has(role)) return undefined;
  seen.add(role);
  const value = palette[role];
  if (!value) return undefined;
  const color = parseCssColor(value, context);
  if (!color) return undefined;
  if (color.a >= 1) return color;
  const behind = BACKDROP[role];
  if (!behind) return undefined;
  const backdrop = resolveSurface(behind, palette, context, seen);
  if (!backdrop) return undefined;
  return compositeOver(color, backdrop);
}

/**
 * The warnings a revision carries, in the shape the console renders and the
 * API will later return: one entry per failing pair per side, and nothing for
 * a pair that passes or could not be measured. An empty array means no
 * warnings.
 *
 * Warning-only by decision: a failing pair never blocks saving or publishing.
 */
export function contrastIssues(branding: {
  theme?: { light?: { palette?: BrandingPaletteColors }; dark?: { palette?: BrandingPaletteColors } };
}): ContrastIssue[] {
  const byTheme = checkBrandingContrast(branding);
  const issues: ContrastIssue[] = [];
  for (const theme of ["light", "dark"] as const) {
    for (const finding of byTheme[theme]) {
      if (finding.status !== "fail" || finding.ratio === undefined) continue;
      issues.push({
        theme,
        pair: finding.id,
        ratio: Math.round(finding.ratio * 100) / 100,
        required: finding.minimum,
      });
    }
  }
  return issues;
}

export type ContrastIssue = {
  theme: "light" | "dark";
  /** Stable pair id, e.g. `on_primary/primary`. */
  pair: string;
  /** Measured ratio, rounded to two decimals. */
  ratio: number;
  /** The ratio this pair had to reach. */
  required: number;
};

/** Both sides of a revision, keyed by the side each finding belongs to. */
export function checkBrandingContrast(branding: {
  theme?: { light?: { palette?: BrandingPaletteColors }; dark?: { palette?: BrandingPaletteColors } };
}): { light: ContrastFinding[]; dark: ContrastFinding[] } {
  return {
    light: checkPaletteContrast(branding.theme?.light?.palette),
    dark: checkPaletteContrast(branding.theme?.dark?.palette),
  };
}
