import { describe, expect, it } from "vitest";

import { designRemovedRule } from "../../../../../src/commands/setup/rules/design-removed";

describe("designRemovedRule", () => {
  it("is broken by any --design", () => {
    expect(designRemovedRule.broken({ flags: { design: "centered" }, args: {}, argv: [] })).toBe(
      true,
    );
  });

  it("holds without it", () => {
    expect(designRemovedRule.broken({ flags: {}, args: {}, argv: [] })).toBe(false);
  });

  it("explains the removal and points at branding eject", () => {
    expect(designRemovedRule.refusal.message).toBe(
      "setup no longer applies a login template, so --design was removed",
    );
    expect(designRemovedRule.refusal.next).toEqual(["branding eject"]);
  });
});
