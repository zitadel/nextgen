/**
 * Mirror of the server's appearance-value gates
 * (`internal/domain/branding_css.go`), so `plan` rejects what `apply` would.
 *
 * The widget writes these values straight into a CSS declaration, so a value
 * able to close its own declaration can emit rules of its own. Both gates are
 * allowlists: a value is accepted only when it matches a form we recognise,
 * never merely because it avoided the characters someone thought to ban.
 */

export const MAX_BRANDING_COLOR_LENGTH = 128;
export const MAX_BRANDING_FONT_FAMILY_LENGTH = 256;
export const MAX_BRANDING_URL_LENGTH = 2048;

const HEX_COLOR = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** `url` is absent by construction: it is not a colour function. */
const COLOR_FUNCTIONS = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
  "color-mix",
]);

const COLOR_ARGS = /^[0-9a-zA-Z%.,+\-/ ()#]*$/;
/**
 * A bare colour name. Which names CSS knows is the browser's business: an
 * unknown one paints nothing, and every name of this shape is inert inside a
 * declaration whatever it spells.
 */
const COLOR_NAME = /^[a-zA-Z]{3,24}$/;
const FONT_IDENT = /^[A-Za-z0-9_-]+( [A-Za-z0-9_-]+)*$/;

function isColorFunction(value: string): boolean {
  const open = value.indexOf("(");
  if (open <= 0 || !value.endsWith(")")) return false;
  if (!COLOR_FUNCTIONS.has(value.slice(0, open))) return false;

  const args = value.slice(open + 1, -1);
  if (!COLOR_ARGS.test(args)) return false;

  // Nesting is legal (`color-mix(in srgb, rgb(1 2 3), red)`), so the
  // parentheses only have to balance, at a bounded depth.
  let depth = 0;
  for (const char of args) {
    if (char === "(") {
      depth += 1;
      if (depth > 4) return false;
    } else if (char === ")") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/** Whether a value is hex, a CSS colour name, or a colour function. */
export function isBrandingColor(value: string): boolean {
  if (value.length > MAX_BRANDING_COLOR_LENGTH) return false;
  if (value.trim() === "") return false;
  // Not trimmed: the value is stored and painted verbatim.
  if (HEX_COLOR.test(value)) return true;
  return COLOR_NAME.test(value) || isColorFunction(value.toLowerCase());
}

/** Whether a value is a CSS font stack of identifiers and quoted names. */
export function isBrandingFontFamily(value: string): boolean {
  if (value.length > MAX_BRANDING_FONT_FAMILY_LENGTH) return false;
  if (value.trim() === "") return false;
  return value.split(",").every((family) => isFontName(trimSpaces(family)));
}

/** Spaces around a comma are ordinary; other whitespace is not a separator. */
function trimSpaces(value: string): string {
  return value.replace(/^ +/, "").replace(/ +$/, "");
}

function isFontName(family: string): boolean {
  if (family === "") return false;
  const quote = family[0];
  if (quote === '"' || quote === "'") {
    // A quoted name ends at its matching quote and holds no other, so it
    // cannot leave the string it opened.
    if (family.length < 2 || family.at(-1) !== quote) return false;
    const inner = family.slice(1, -1);
    return !inner.includes(quote) && !/[\\;{}]/.test(inner);
  }
  return FONT_IDENT.test(family);
}
