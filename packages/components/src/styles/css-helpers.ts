import { unsafeCSS, type CSSResult } from "lit";

import { cssVar, type DesignToken } from "../tokens/css-var.js";

/**
 * Lit's `css` tagged template explicitly forbids string interpolation as a
 * security guarantee. Atoms reference design tokens dozens of times each,
 * so this helper wraps the (constant, controlled) `var(...)` reference in
 * `unsafeCSS` once. Importing this from a single module keeps every atom
 * out of the `unsafeCSS` business.
 *
 * Usage:
 *
 *   import { cssTokenVar as v } from "../styles/css-helpers.js";
 *   ...
 *   color: ${v(tokens.color.text)};
 */
export function cssTokenVar(token: DesignToken): CSSResult {
  return unsafeCSS(cssVar(token));
}
