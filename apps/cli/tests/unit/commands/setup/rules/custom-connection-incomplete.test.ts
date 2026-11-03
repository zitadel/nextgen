import { describe, expect, it } from "vitest";

import { customConnectionIncompleteRule } from "../../../../../src/commands/setup/rules/custom-connection-incomplete";

const broken = (flags: Record<string, unknown>) => {
  return customConnectionIncompleteRule.broken({ flags, args: {}, argv: [] });
};

describe("customConnectionIncompleteRule", () => {
  it("names what a scripted run left out", () => {
    expect(broken({ sso: "custom", nonInteractive: true, ssoSlug: "x" })).toEqual({
      list: "--sso-display-name, --sso-issuer",
      missing: ["--sso-display-name", "--sso-issuer"],
    });
  });

  it("holds when the connection is described", () => {
    expect(
      broken({
        sso: "custom",
        nonInteractive: true,
        ssoSlug: "x",
        ssoDisplayName: "X",
        ssoIssuer: "https://x",
      }),
    ).toBe(false);
  });

  it("holds for another provider", () => {
    expect(broken({ sso: "google", nonInteractive: true })).toBe(false);
  });

  it("shows an example of the full description", () => {
    expect(customConnectionIncompleteRule.refusal.hint).toContain("--sso custom --sso-slug");
  });
});
