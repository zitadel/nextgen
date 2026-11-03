import { describe, expect, it } from "vitest";

import { settingsNeedCustomRule } from "../../../../../src/commands/setup/rules/settings-need-custom";

const broken = (flags: Record<string, unknown>) => {
  return settingsNeedCustomRule.broken({ flags, args: {}, argv: [] });
};

describe("settingsNeedCustomRule", () => {
  it("names the settings given beside a catalog provider", () => {
    expect(broken({ sso: "google", ssoIssuer: "https://x", ssoSlug: "x" })).toEqual({
      names: "--sso-slug, --sso-issuer",
      them: "them",
      flags: ["--sso-slug", "--sso-issuer"],
    });
  });

  it("says it for one setting", () => {
    expect(broken({ sso: "google", ssoIssuer: "https://x" })).toMatchObject({ them: "it" });
  });

  it.each([{ sso: "custom", ssoSlug: "x" }, { sso: "google" }, { ssoSlug: "x" }])(
    "lets %j through",
    (flags) => {
      expect(broken(flags)).toBe(false);
    },
  );

  it("explains the refusal", () => {
    expect(settingsNeedCustomRule.refusal.message).toBe(
      "{names} only applies to a custom connection",
    );
  });
});
