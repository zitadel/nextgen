import { describe, expect, it } from "vitest";

import { secretAsStringRule } from "../../../../../../src/commands/variable/set/rules/secret-as-string";

describe("secretAsStringRule", () => {
  it("is broken for a secret stored as another type", () => {
    expect(
      secretAsStringRule.broken({ flags: { secret: true, as: "number" }, args: {}, argv: [] }),
    ).toBe(true);
  });

  it("holds for a secret stored as a string", () => {
    expect(
      secretAsStringRule.broken({ flags: { secret: true, as: "string" }, args: {}, argv: [] }),
    ).toBe(false);
  });

  it("holds for a plain number", () => {
    expect(
      secretAsStringRule.broken({ flags: { secret: false, as: "number" }, args: {}, argv: [] }),
    ).toBe(false);
  });

  it("says what to drop", () => {
    expect(secretAsStringRule.refusal).toEqual({
      message: "A secret is stored as a string.",
      hint: "Drop --as, or drop --secret for a non-credential number or boolean.",
    });
  });
});
