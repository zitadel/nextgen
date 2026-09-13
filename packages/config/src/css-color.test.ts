import { describe, expect, it } from "vitest";

import { compositeOver, parseCssColor, relativeLuminance, type Rgba } from "./css-color.js";

/** Round to whole channels for comparison against published values. */
function rgb(input: string): string | undefined {
  return rgbWith(input, {});
}

function rgbWith(input: string, context: Parameters<typeof parseCssColor>[1]): string | undefined {
  const c = parseCssColor(input, context);
  if (!c) return undefined;
  return `${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${Number(c.a.toFixed(3))}`;
}

describe("parseCssColor", () => {
  it("reads named colours", () => {
    expect(rgb("rebeccapurple")).toBe("102,51,153,1");
    expect(rgb("RebeccaPurple")).toBe("102,51,153,1");
    expect(rgb("transparent")).toBe("0,0,0,0");
    expect(rgb("notacolour")).toBeUndefined();
  });

  it("reads every hex length", () => {
    expect(rgb("#f00")).toBe("255,0,0,1");
    expect(rgb("#ff0000")).toBe("255,0,0,1");
    expect(rgb("#ff000080")).toBe("255,0,0,0.502");
    expect(rgb("#f008")).toBe("255,0,0,0.533");
    expect(rgb("#12345")).toBeUndefined();
  });

  it("reads rgb in both syntaxes", () => {
    expect(rgb("rgb(255, 0, 0)")).toBe("255,0,0,1");
    expect(rgb("rgb(255 0 0)")).toBe("255,0,0,1");
    expect(rgb("rgba(255, 0, 0, 0.5)")).toBe("255,0,0,0.5");
    expect(rgb("rgb(255 0 0 / 50%)")).toBe("255,0,0,0.5");
    expect(rgb("rgb(100% 0% 0%)")).toBe("255,0,0,1");
  });

  it("reads hsl and hwb", () => {
    expect(rgb("hsl(0 100% 50%)")).toBe("255,0,0,1");
    expect(rgb("hsl(120, 100%, 50%)")).toBe("0,255,0,1");
    expect(rgb("hsl(240 100% 50%)")).toBe("0,0,255,1");
    expect(rgb("hsl(0 0% 100%)")).toBe("255,255,255,1");
    expect(rgb("hwb(0 0% 0%)")).toBe("255,0,0,1");
    expect(rgb("hwb(0 100% 0%)")).toBe("255,255,255,1");
    expect(rgb("hwb(0 0% 100%)")).toBe("0,0,0,1");
  });

  // Anchors from CSS Color 4: sRGB red is lab(54.29 80.8 69.9), which is
  // lch(54.29 106.84 40.85); white is lab(100 0 0).
  it("reads lab and lch", () => {
    expect(rgb("lab(100 0 0)")).toBe("255,255,255,1");
    expect(rgb("lab(0 0 0)")).toBe("0,0,0,1");
    expect(rgb("lab(54.29 80.8 69.9)")).toBe("255,0,0,1");
    expect(rgb("lch(54.29 106.84 40.85)")).toBe("255,0,0,1");
  });

  // sRGB red is oklch(0.628 0.2577 29.23) / oklab(0.628 0.2248 0.1258).
  it("reads oklab and oklch", () => {
    expect(rgb("oklab(1 0 0)")).toBe("255,255,255,1");
    expect(rgb("oklab(0 0 0)")).toBe("0,0,0,1");
    expect(rgb("oklch(0.628 0.2577 29.23)")).toBe("255,0,0,1");
    expect(rgb("oklab(0.628 0.2248 0.1258)")).toBe("255,0,0,1");
    expect(rgb("oklch(70% 0 0)")).toBe(rgb("oklab(0.7 0 0)"));
  });

  it("resolves color() into sRGB", () => {
    // Out-of-gamut channels clamp, which is what a browser shows anyway.
    expect(rgb("color(display-p3 1 0 0)")).toBe("255,0,0,1");
    expect(rgb("color(srgb 1 0 0)")).toBe("255,0,0,1");
  });

  it("rejects a malformed function rather than guessing", () => {
    expect(rgb("rgb(1 2)")).toBeUndefined();
    expect(rgb("notafunction(1 2 3)")).toBeUndefined();
  });

  it("wraps hue and clamps out-of-range channels", () => {
    expect(rgb("hsl(360 100% 50%)")).toBe(rgb("hsl(0 100% 50%)"));
    expect(rgb("hsl(-120 100% 50%)")).toBe(rgb("hsl(240 100% 50%)"));
    expect(rgb("rgb(300 -20 0)")).toBe("255,0,0,1");
  });
});

describe("color-mix", () => {
  it("mixes evenly when no percentage is given", () => {
    expect(rgb("color-mix(in srgb, white, black)")).toBe("128,128,128,1");
  });

  it("honours a single percentage as the other's complement", () => {
    expect(rgb("color-mix(in srgb, white 100%, black)")).toBe("255,255,255,1");
    expect(rgb("color-mix(in srgb, white 0%, black)")).toBe("0,0,0,1");
    expect(rgb("color-mix(in srgb, white 25%, black)")).toBe("64,64,64,1");
  });

  it("takes the percentage on either side of the colour", () => {
    expect(rgb("color-mix(in srgb, 25% white, black)")).toBe(
      rgb("color-mix(in srgb, white 25%, black)"),
    );
  });

  it("carries the alpha of a pair summing under 100%", () => {
    // CSS Color 5: the mix is still even, but the result is 40% opaque —
    // which is what makes this different from an even mix.
    expect(rgb("color-mix(in srgb, red 20%, blue 20%)")).toBe("128,0,128,0.4");
  });

  it("normalises a pair summing over 100%", () => {
    expect(rgb("color-mix(in srgb, white 75%, black 75%)")).toBe(
      rgb("color-mix(in srgb, white, black)"),
    );
  });

  it("mixes in the named space, not always sRGB", () => {
    // A mid-grey in sRGB and in OKLab are different colours; if they came back
    // equal, the space argument would be being ignored.
    expect(rgb("color-mix(in oklab, white, black)")).not.toBe(
      rgb("color-mix(in srgb, white, black)"),
    );
  });

  it("accepts a hue strategy in a polar space", () => {
    const shorter = rgb("color-mix(in oklch, red, blue)");
    const longer = rgb("color-mix(in oklch longer hue, red, blue)");
    expect(shorter).toBeDefined();
    expect(longer).toBeDefined();
    expect(longer).not.toBe(shorter);
  });

  it("resolves a nested mix", () => {
    expect(rgb("color-mix(in srgb, color-mix(in srgb, white, black), black)")).toBe("64,64,64,1");
  });

  it("rejects an unknown space or a malformed strategy", () => {
    expect(rgb("color-mix(in nonsense, white, black)")).toBeUndefined();
    expect(rgb("color-mix(in oklch sideways hue, red, blue)")).toBeUndefined();
    expect(rgb("color-mix(in oklch longer, red, blue)")).toBeUndefined();
    expect(rgb("color-mix(in srgb, white)")).toBeUndefined();
  });
});

describe("currentColor", () => {
  it("resolves against the colour the caller says it inherits", () => {
    const c = parseCssColor("currentColor", { currentColor: "#EB3614" });
    expect(c && `${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)}`).toBe("235,54,20");
  });

  it("is unresolved with nothing to inherit from", () => {
    expect(parseCssColor("currentColor")).toBeUndefined();
  });

  it("refuses a colour defined as itself", () => {
    expect(parseCssColor("currentColor", { currentColor: "currentColor" })).toBeUndefined();
  });

  it("is case-insensitive, as CSS keywords are", () => {
    expect(parseCssColor("CURRENTCOLOR", { currentColor: "white" })).toBeDefined();
  });

  it("resolves inside a mix", () => {
    expect(
      rgbWith("color-mix(in srgb, currentColor, black)", { currentColor: "white" }),
    ).toBe("128,128,128,1");
  });
});

describe("compositeOver", () => {
  it("blends a translucent colour into its backdrop", () => {
    const white: Rgba = { r: 255, g: 255, b: 255, a: 1 };
    const halfBlack = parseCssColor("#00000080") as Rgba;
    const blended = compositeOver(halfBlack, white);
    expect(Math.round(blended.r)).toBe(127);
    expect(blended.a).toBe(1);
  });

  it("returns an opaque colour untouched", () => {
    const red = parseCssColor("#ff0000") as Rgba;
    expect(compositeOver(red, { r: 0, g: 0, b: 0, a: 1 })).toEqual(red);
  });
});

describe("relativeLuminance", () => {
  it("matches the WCAG anchors", () => {
    expect(relativeLuminance(parseCssColor("#ffffff") as Rgba)).toBeCloseTo(1, 6);
    expect(relativeLuminance(parseCssColor("#000000") as Rgba)).toBeCloseTo(0, 6);
    expect(relativeLuminance(parseCssColor("#808080") as Rgba)).toBeCloseTo(0.2159, 3);
  });
});
