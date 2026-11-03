import { describe, expect, it } from "vitest";

import { unknownDesignRule } from "../../../../../src/commands/branding/rules/unknown-design";

const broken = (design: unknown) => {
  return unknownDesignRule.broken({ flags: { design }, args: {}, argv: [] });
};

describe("unknownDesignRule", () => {
  it("refuses a design that is neither shipped nor retired", () => {
    expect(broken("neon")).toBe(true);
  });

  it.each(["centered", "minimal", "hero", undefined])("lets %s through", (design) => {
    expect(broken(design)).toBe(false);
  });

  it("lists the catalog", () => {
    expect(unknownDesignRule.refusal.hint).toBe("Pick one of: centered, minimal.");
  });
});
