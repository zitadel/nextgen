import { describe, expect, it } from "vitest";

import { flattenTokens, tokens } from "./catalogue.js";

describe("token catalogue", () => {
  it("defines stable --zl-* names", () => {
    for (const token of flattenTokens()) {
      expect(token.name.startsWith("--zl-")).toBe(true);
      expect(token.default.length).toBeGreaterThan(0);
    }
  });

  it("has unique token names", () => {
    const names = flattenTokens().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("exposes the documented core palette", () => {
    expect(tokens.color.primary.name).toBe("--zl-color-primary");
    expect(tokens.color.onPrimary.name).toBe("--zl-color-on-primary");
    expect(tokens.color.background.name).toBe("--zl-color-background");
    expect(tokens.color.surface.name).toBe("--zl-color-surface");
    expect(tokens.color.text.name).toBe("--zl-color-text");
    expect(tokens.radius.md.name).toBe("--zl-radius-md");
    expect(tokens.font.family.name).toBe("--zl-font-family");
  });
});
