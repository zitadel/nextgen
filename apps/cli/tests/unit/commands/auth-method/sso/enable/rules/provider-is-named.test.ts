import { describe, expect, it } from "vitest";

import { providerIsNamedRule } from "../../../../../../../src/commands/auth-method/sso/enable/rules/provider-is-named";

describe("providerIsNamedRule", () => {
  it("is broken when no provider is named", () => {
    expect(providerIsNamedRule.broken({ flags: {}, args: {}, argv: [] })).toBe(true);
  });

  it("holds when a provider is named", () => {
    expect(providerIsNamedRule.broken({ flags: { provider: "google" }, args: {}, argv: [] })).toBe(
      false,
    );
  });

  it("names the next move", () => {
    expect(providerIsNamedRule.refusal).toEqual({
      message: "Name the provider to enable",
      hint: "Pass --provider, e.g. --provider google.",
    });
  });
});
