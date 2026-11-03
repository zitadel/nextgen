import { describe, expect, it } from "vitest";

import { valueTypeRule } from "../../../../../../src/commands/variable/set/rules/value-type";

describe("valueTypeRule", () => {
  it.each([
    ["maybe", "boolean"],
    ["abc", "number"],
  ])("is broken for %j as %s", (value, as) => {
    expect(valueTypeRule.broken({ flags: { as }, args: { value }, argv: [] })).toBe(true);
  });

  it.each([
    ["true", "boolean"],
    ["1e3", "number"],
    ["anything", "string"],
  ])("holds for %j as %s", (value, as) => {
    expect(valueTypeRule.broken({ flags: { as }, args: { value }, argv: [] })).toBe(false);
  });

  it("holds when no value is given", () => {
    expect(valueTypeRule.broken({ flags: { as: "number" }, args: {}, argv: [] })).toBe(false);
  });

  it("names the value and the type", () => {
    expect(valueTypeRule.refusal.message).toBe('"{value}" is not a valid {as} value.');
  });
});
