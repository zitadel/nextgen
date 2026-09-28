import { THEME_SELECTORS, tokensCss } from "@zitadel/design-tokens";

import { PALETTE_KEYS, type PaletteKey, type ThemeSide } from "./branding-palette";

/**
 * The variable each palette key paints first — the value a revision that omits
 * the key falls back to. Mirrors the first entry of the widget's palette map.
 */
const PALETTE_VARIABLE: Record<PaletteKey, string> = {
  primary: "--zl-primary",
  on_primary: "--zl-primary-foreground",
  background: "--zl-background",
  surface: "--zl-card",
  muted: "--zl-muted",
  text_muted: "--zl-muted-foreground",
  text: "--zl-foreground",
  link: "--zl-link",
  border: "--zl-border",
  success: "--zl-success",
  warning: "--zl-warning",
  error: "--zl-destructive",
};

function declarations(selector: string): Map<string, string> {
  const start = tokensCss.indexOf(`${selector} {`);
  const body = start === -1 ? "" : tokensCss.slice(start, tokensCss.indexOf("}", start));
  const out = new Map<string, string>();
  for (const match of body.matchAll(/(--zl-[\w-]+):\s*([^;]+);/g)) {
    out.set(match[1] as string, (match[2] as string).trim());
  }
  return out;
}

// The dark block also applies to the bare root, so a variable the light block
// does not redefine is inherited from it.
const DARK = declarations(THEME_SELECTORS.dark);
const LIGHT = new Map([...DARK, ...declarations(THEME_SELECTORS.light)]);

/**
 * The maintained colour for each palette key on one side. `link` defaults to
 * `currentColor`, which on the card is the side's text, so that is what it
 * shows.
 */
export function maintainedPalette(side: ThemeSide): Record<PaletteKey, string> {
  const source = side === "light" ? LIGHT : DARK;
  const palette = {} as Record<PaletteKey, string>;
  for (const key of PALETTE_KEYS) {
    palette[key] = source.get(PALETTE_VARIABLE[key]) ?? "";
  }
  if (palette.link.toLowerCase() === "currentcolor") palette.link = palette.text;
  return palette;
}

/** The first family in the maintained sans stack, which is what the login renders in. */
export const MAINTAINED_FONT_FAMILY =
  (DARK.get("--zl-font-family-sans") ?? "").split(",")[0]?.replace(/"/g, "").trim() ?? "";
