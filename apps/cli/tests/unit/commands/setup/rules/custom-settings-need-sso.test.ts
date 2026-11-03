import { describe, expect, it } from "vitest";

import { customSettingsNeedSsoRules } from "../../../../../src/commands/setup/rules/custom-settings-need-sso";

function refusalFor(flags: Record<string, unknown>) {
  return customSettingsNeedSsoRules.find((rule) => rule.broken({ flags, args: {}, argv: [] }))
    ?.refusal;
}

describe("customSettingsNeedSsoRules", () => {
  it.each([
    ["ssoSlug", "--sso-slug"],
    ["ssoDisplayName", "--sso-display-name"],
    ["ssoIssuer", "--sso-issuer"],
    ["ssoScopes", "--sso-scopes"],
  ])("refuses %s with no provider, naming %s", (key, flag) => {
    expect(refusalFor({ [key]: "x" })?.message).toBe(`${flag} needs --sso custom`);
  });

  it("lets a setting through beside a provider, and a run with none", () => {
    expect(refusalFor({ ssoSlug: "x", sso: "custom" })).toBeUndefined();
    expect(refusalFor({})).toBeUndefined();
  });
});
