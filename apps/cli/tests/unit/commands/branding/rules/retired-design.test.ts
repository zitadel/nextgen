import { describe, expect, it } from "vitest";

import { retiredDesignRule } from "../../../../../src/commands/branding/rules/retired-design";

const broken = (design: unknown) => {
  return retiredDesignRule.broken({ flags: { design }, args: {}, argv: [] });
};

describe("retiredDesignRule", () => {
  it.each(["split", "split-right", "hero"])("refuses the retired design %s", (design) => {
    expect(broken(design)).toBe(true);
  });

  it.each(["centered", "neon", undefined])("lets %s through", (design) => {
    expect(broken(design)).toBe(false);
  });

  it("names the design and the command that replaces it", () => {
    expect(retiredDesignRule.refusal.message).toBe(
      "The {design} design was retired: it was page layout, not widget structure",
    );
    expect(retiredDesignRule.refusal.next).toEqual(["branding eject --design centered"]);
  });
});
