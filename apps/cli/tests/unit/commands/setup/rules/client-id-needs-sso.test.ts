import { describe, expect, it } from "vitest";

import { clientIdNeedsSsoRule } from "../../../../../src/commands/setup/rules/client-id-needs-sso";

const broken = (flags: Record<string, unknown>) => {
  return clientIdNeedsSsoRule.broken({ flags, args: {}, argv: [] });
};

describe("clientIdNeedsSsoRule", () => {
  it("refuses a client id with no provider", () => {
    expect(broken({ ssoClientId: "abc" })).toBe(true);
  });

  it.each([{ ssoClientId: "abc", sso: "google" }, {}])("lets %j through", (flags) => {
    expect(broken(flags)).toBe(false);
  });

  it("says how to name the provider", () => {
    expect(clientIdNeedsSsoRule.refusal).toMatchObject({
      message: "--sso-client-id needs --sso",
      hint: "Name the provider with --sso, e.g. --sso google.",
    });
  });
});
