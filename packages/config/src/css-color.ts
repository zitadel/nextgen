/**
 * Resolves the colour forms a branding palette accepts to sRGB, so a contrast
 * ratio can be measured without a rendering engine.
 *
 * `branding-css.ts` says which forms are *storable*; this says what they
 * *are*. Culori covers the plain forms and `color()`. Two forms it cannot
 * take alone are handled here, because both need something only this codebase
 * knows:
 *
 * - `color-mix()` is a recipe rather than a colour. Culori has the colour
 *   spaces and the interpolation; the mixing rules (percentage normalisation,
 *   the alpha carried by a pair summing under 100%, the hue strategy) come
 *   from CSS Color 5 and live here.
 * - `currentColor` means the inherited text colour at the point of use. In
 *   general CSS that is unknowable without rendering. In a branding palette it
 *   is not: we own the surface, so the caller says which colour the token
 *   would inherit — for anything drawn on the card, the side's own `text`.
 */
import {
  converter,
  fixupHueDecreasing,
  fixupHueIncreasing,
  fixupHueLonger,
  fixupHueShorter,
  interpolateWithPremultipliedAlpha,
  parse,
  type Color,
} from "culori";

/** An sRGB colour, channels 0-255, alpha 0-1. */
export type Rgba = { r: number; g: number; b: number; a: number };

export type ResolveContext = {
  /**
   * What `currentColor` inherits at the point this value is painted. Left
   * unset, `currentColor` stays unresolved rather than being guessed at.
   */
  currentColor?: string;
};

const toRgb = converter("rgb");

/** Interpolation spaces CSS names, mapped to culori's modes. */
const MIX_SPACES: Record<string, string> = {
  srgb: "rgb",
  "srgb-linear": "lrgb",
  hsl: "hsl",
  hwb: "hwb",
  lab: "lab",
  lch: "lch",
  oklab: "oklab",
  oklch: "oklch",
  xyz: "xyz65",
  "xyz-d50": "xyz50",
  "xyz-d65": "xyz65",
  "display-p3": "p3",
  "a98-rgb": "a98",
  "prophoto-rgb": "prophoto",
  rec2020: "rec2020",
};

/** Only a polar space has a hue to interpolate, so only these take a strategy. */
const POLAR_SPACES = new Set(["hsl", "hwb", "lch", "oklch"]);

const HUE_FIXUPS: Record<string, (hues: number[]) => number[]> = {
  shorter: fixupHueShorter,
  longer: fixupHueLonger,
  increasing: fixupHueIncreasing,
  decreasing: fixupHueDecreasing,
};

/** Depth guard: the storage gate bounds nesting at four, so this is slack. */
const MAX_DEPTH = 6;

/**
 * Parse any colour form a palette accepts. Returns `undefined` for a value
 * that is malformed, or for `currentColor` with no context to resolve it
 * against.
 */
export function parseCssColor(input: string, context: ResolveContext = {}): Rgba | undefined {
  return resolve(input, context, 0);
}

function resolve(input: string, context: ResolveContext, depth: number): Rgba | undefined {
  if (depth > MAX_DEPTH) return undefined;
  const value = input.trim();
  if (value === "") return undefined;

  if (value.toLowerCase() === "currentcolor") {
    if (!context.currentColor) return undefined;
    // The inherited value can itself be any accepted form, but it cannot be
    // `currentColor` again: that would be a colour defined as itself.
    if (context.currentColor.trim().toLowerCase() === "currentcolor") return undefined;
    return resolve(context.currentColor, context, depth + 1);
  }

  if (value.toLowerCase().startsWith("color-mix(")) {
    return resolveMix(value.slice("color-mix(".length, -1), context, depth);
  }

  const parsed = parse(value);
  if (!parsed) return undefined;
  return fromCulori(parsed);
}

/**
 * `in <space> [<hue> hue], <colour> [<percent>], <colour> [<percent>]`.
 *
 * Percentages follow CSS Color 5: both omitted is an even mix; one given
 * makes the other its complement; a pair that sums to less than 100% mixes in
 * that proportion and multiplies the result's alpha by the sum, which is what
 * makes `color-mix(in srgb, red 20%, blue 20%)` translucent rather than an
 * even mix.
 */
function resolveMix(body: string, context: ResolveContext, depth: number): Rgba | undefined {
  const parts = splitTopLevel(body);
  if (parts.length !== 3) return undefined;
  const [spec, first, second] = parts as [string, string, string];

  const specTokens = spec.trim().toLowerCase().split(/\s+/);
  if (specTokens[0] !== "in") return undefined;
  const space = specTokens[1] ?? "";
  const mode = MIX_SPACES[space];
  if (!mode) return undefined;

  let fixup = fixupHueShorter;
  if (specTokens.length > 2) {
    // `in oklch longer hue` — the trailing `hue` keyword is required with a
    // method, and a rectangular space has no hue to interpolate, so CSS
    // rejects the method there and so do we.
    if (!POLAR_SPACES.has(space)) return undefined;
    if (specTokens.length !== 4 || specTokens[3] !== "hue") return undefined;
    const named = HUE_FIXUPS[specTokens[2] as string];
    if (!named) return undefined;
    fixup = named;
  }

  const a = splitColorAndPercent(first);
  const b = splitColorAndPercent(second);
  if (!a || !b) return undefined;

  const [p1, p2] = normalisePercentages(a.percent, b.percent);
  const sum = p1 + p2;
  if (sum <= 0) return undefined;
  const alphaScale = sum < 100 ? sum / 100 : 1;
  const weight = p2 / sum;

  const c1 = resolve(a.color, context, depth + 1);
  const c2 = resolve(b.color, context, depth + 1);
  if (!c1 || !c2) return undefined;

  // CSS mixes in premultiplied alpha: mixing red with transparent has to keep
  // red's hue and lose opacity, not slide towards transparent black.
  const mixed = interpolateWithPremultipliedAlpha([toCulori(c1), toCulori(c2)], mode as never, {
    h: { fixup },
  } as never)(weight);
  const rgba = fromCulori(mixed);
  if (!rgba) return undefined;
  return { ...rgba, a: clamp(rgba.a * alphaScale, 0, 1) };
}

function normalisePercentages(first: number | undefined, second: number | undefined): [number, number] {
  if (first === undefined && second === undefined) return [50, 50];
  if (first === undefined) return [100 - (second as number), second as number];
  if (second === undefined) return [first, 100 - first];
  return [first, second];
}

/** Split on commas that are not inside parentheses. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts;
}

/**
 * `#fff 30%` or `30% #fff` — CSS allows the percentage on either side of the
 * colour. Only a percentage outside any parentheses is the mix stop: the `100%`
 * in `hsl(0 100% 50%)` belongs to the colour, not to the mix.
 */
function splitColorAndPercent(input: string): { color: string; percent?: number } | undefined {
  const trimmed = input.trim();
  if (trimmed === "") return undefined;

  let depth = 0;
  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "%" && depth === 0) {
      const start = startOfNumber(trimmed, i);
      if (start === undefined) return undefined;
      const percent = Number.parseFloat(trimmed.slice(start, i));
      // CSS Color 5 bounds a mix stop to 0-100%: beyond that a mix would be an
      // extrapolation, which culori would happily compute and a browser refuses.
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) return undefined;
      const color = (trimmed.slice(0, start) + trimmed.slice(i + 1)).trim();
      if (color === "") return undefined;
      return { color, percent };
    }
  }
  return { color: trimmed };
}

/** Walk back over the number preceding a `%`, returning where it starts. */
function startOfNumber(input: string, percentIndex: number): number | undefined {
  let i = percentIndex - 1;
  while (i >= 0 && /[\d.]/.test(input[i] as string)) i -= 1;
  if (i >= 0 && input[i] === "-") i -= 1;
  const start = i + 1;
  if (start === percentIndex) return undefined;
  // A stop is its own token: `50%` is one, the `0%` of `hsl(0 0% 50%)` is not
  // reachable here because that sits inside parentheses.
  if (start > 0 && !/\s/.test(input[start - 1] as string)) return undefined;
  return start;
}

function fromCulori(color: Color): Rgba | undefined {
  const rgb = toRgb(color);
  if (!rgb) return undefined;
  const channel = (value: number | undefined): number => clamp((value ?? 0) * 255, 0, 255);
  return { r: channel(rgb.r), g: channel(rgb.g), b: channel(rgb.b), a: clamp(rgb.alpha ?? 1, 0, 1) };
}

function toCulori({ r, g, b, a }: Rgba): Color {
  return { mode: "rgb", r: r / 255, g: g / 255, b: b / 255, alpha: a };
}

/**
 * Composite a colour over an opaque backdrop. A translucent foreground is what
 * the reader sees blended with what is behind it, so a ratio measured against
 * the raw value would describe a colour nobody sees.
 */
export function compositeOver(color: Rgba, backdrop: Rgba): Rgba {
  if (color.a >= 1) return color;
  const a = color.a;
  return {
    r: color.r * a + backdrop.r * (1 - a),
    g: color.g * a + backdrop.g * (1 - a),
    b: color.b * a + backdrop.b * (1 - a),
    a: 1,
  };
}

/** WCAG 2.2 relative luminance of an opaque sRGB colour. */
export function relativeLuminance({ r, g, b }: Rgba): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
