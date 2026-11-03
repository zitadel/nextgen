import { describe, expect, it } from "vitest";

import { secretValueRule } from "../../../../../../src/commands/variable/set/rules/secret-value";

describe("secretValueRule", () => {
  it("is broken for a secret given with a value", () => {
    expect(
      secretValueRule.broken({ flags: { secret: true }, args: { value: "x" }, argv: [] }),
    ).toBe(true);
  });

  it("holds for a secret with no value", () => {
    expect(secretValueRule.broken({ flags: { secret: true }, args: {}, argv: [] })).toBe(false);
  });

  it("says where a secret comes from instead", () => {
    expect(secretValueRule.refusal).toEqual({
      message: "A secret value is not given on the command line.",
      hint: "Drop the value and pipe it in, or let the prompt ask for it.",
    });
  });
});
