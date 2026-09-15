/**
 * Parity between our colour resolver and the browser that paints the palette.
 *
 * The resolver lives in `@zitadel/config` — the CLI and the server-side gate
 * need it, and neither has a browser. That is exactly why this test is here:
 * `packages/components` owns the only Chromium project in the workspace, and a
 * resolver whose answers drift from what Chrome renders would report contrast
 * for a colour nobody sees.
 *
 * Ground truth is a painted pixel rather than `getComputedStyle`, which
 * reports wide-gamut values in their own space instead of sRGB.
 */
import { parseCssColor } from "@zitadel/config/css-color";
import { describe, expect, it } from "vitest";

const VALUES = [
  "rebeccapurple",
  "#4F46E5",
  "hwb(90 10% 20%)",
  "lab(54.29 80.8 69.9)",
  "lch(54.29 106.84 40.85)",
  "oklab(0.628 0.2248 0.1258)",
  "oklch(0.628 0.2577 29.23)",
  "oklch(0.7 0.15 250)",
  "color(display-p3 1 0 0)",
  "color(srgb 0.3 0.6 0.9)",
  "color-mix(in oklab, #A5B4FC 40%, white)",
  "color-mix(in oklch, red, blue)",
  "color-mix(in oklch longer hue, red, blue)",
  "color-mix(in hsl, red 30%, blue)",
  "color-mix(in srgb, white 25%, black)",
  "color-mix(in display-p3, red, blue)",
  "color-mix(in rec2020, red, blue)",
  "color-mix(in srgb, hsl(0 100% 50%), black)",
  "color-mix(in srgb, red, transparent)",
  "color-mix(in oklab, rgb(255 0 0 / 50%), blue)",
];

function painted(value: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return `${r},${g},${b},${Math.round((a / 255) * 100) / 100}`;
}

function resolved(value: string): string {
  const c = parseCssColor(value);
  if (!c) throw new Error(`unresolved: ${value}`);
  return `${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${Math.round(c.a * 100) / 100}`;
}

describe("css colour resolution matches the browser", () => {
  for (const value of VALUES) {
    it(`resolves ${value} the way Chrome paints it`, () => {
      // Canvas stores premultiplied alpha, so a translucent value rounds a
      // channel by one; compare within that rather than exactly.
      const [pr, pg, pb, pa] = painted(value).split(",").map(Number) as number[];
      const [rr, rg, rb, ra] = resolved(value).split(",").map(Number) as number[];
      expect(Math.abs((rr as number) - (pr as number))).toBeLessThanOrEqual(1);
      expect(Math.abs((rg as number) - (pg as number))).toBeLessThanOrEqual(1);
      expect(Math.abs((rb as number) - (pb as number))).toBeLessThanOrEqual(1);
      expect(Math.abs((ra as number) - (pa as number))).toBeLessThanOrEqual(0.01);
    });
  }
});
