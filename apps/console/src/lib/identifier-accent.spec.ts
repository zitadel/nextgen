import { THEME_SELECTORS, tokensCss } from "@zitadel/design-tokens";
import { describe, expect, it } from "vitest";

import { ACCENT_HUES, FOREGROUND_MIX, identifierAccents } from "./identifier-accent";

/**
 * The accents are CSS expressions (`oklch(from …)`, `color-mix(in oklch, …)`)
 * that only a browser resolves, so this spec resolves them the same way — the
 * CSS Color 4 conversions, from the design tokens' own values — and holds the
 * result to WCAG AA. A token change that drops an accent below contrast fails
 * here rather than on screen.
 *
 * The values were checked against Chromium's rendering of the same
 * expressions, which they match to within a unit per channel.
 */

type Rgb = [number, number, number];
type Lch = [number, number, number];

function declarations(selector: string): Map<string, string> {
  const start = tokensCss.indexOf(`${selector} {`);
  const body = start === -1 ? "" : tokensCss.slice(start, tokensCss.indexOf("}", start));
  return new Map(
    [...body.matchAll(/(--zl-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, m[2] as string]),
  );
}

const DARK = declarations(THEME_SELECTORS.dark);
const THEMES = {
  dark: DARK,
  light: new Map([...DARK, ...declarations(THEME_SELECTORS.light)]),
};

function hex(value: string | undefined): Rgb {
  const digits = (value ?? "").replace("#", "");
  return [0, 2, 4].map((at) => Number.parseInt(digits.slice(at, at + 2), 16) / 255) as Rgb;
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function toOklch([r, g, b]: Rgb): Lch {
  const [lr, lg, lb] = [r, g, b].map(toLinear) as Rgb;
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, bb), (Math.atan2(bb, a) * 180) / Math.PI];
}

/** OKLCH to sRGB, clipped into gamut per channel. */
function toRgb([L, C, H]: Lch): Rgb {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return linear.map((v) => Math.min(1, Math.max(0, fromLinear(v)))) as Rgb;
}

/** `amount` of `over` composited onto `under`, in sRGB — an alpha fill. */
function over(colour: Rgb, amount: number, under: Rgb): Rgb {
  return colour.map((v, i) => v * amount + (under[i] as number) * (1 - amount)) as Rgb;
}

function contrast(a: Rgb, b: Rgb): number {
  const luminance = (c: Rgb) => {
    const [r, g, bl] = c.map(toLinear) as Rgb;
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * `color-mix(in oklch, oklch(from chart-1 l c <hue>), foreground <mix>%)`.
 * The foreground is achromatic, so its hue is powerless and the mix keeps the
 * accent's.
 */
function accent(theme: Map<string, string>, hue: number): Rgb {
  const [l1, c1] = toOklch(hex(theme.get("--zl-chart-1")));
  const [l2, c2] = toOklch(hex(theme.get("--zl-foreground")));
  const t = FOREGROUND_MIX / 100;
  return toRgb([l1 * (1 - t) + l2 * t, c1 * (1 - t) + c2 * t, hue]);
}

describe("identifier accents", () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    const card = hex(theme.get("--zl-card"));
    // The hovered row: `hover:bg-muted/40` over the card.
    const row = over(hex(theme.get("--zl-muted")), 0.4, card);

    for (const hue of ACCENT_HUES) {
      it(`reads at AA in ${name}, hue ${hue}`, () => {
        const colour = accent(theme, hue);
        // The lit column header, on the card.
        expect(contrast(colour, card)).toBeGreaterThanOrEqual(4.5);
        // The source cell's value, on the hovered row.
        expect(contrast(colour, row)).toBeGreaterThanOrEqual(4.5);
        // The chip's label, on its own 14% fill over the hovered row.
        expect(contrast(colour, over(colour, 0.14, row))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("gives each property its own hue, in name order", () => {
    const accents = identifierAccents(["username", "email"]);
    expect([...accents.keys()]).toEqual(["email", "username"]);
    expect(accents.get("email")).toContain(`l c ${ACCENT_HUES[0]})`);
    expect(accents.get("username")).toContain(`l c ${ACCENT_HUES[1]})`);
  });
});
