import { describe, expect, it } from "vitest";

import { ssoNeedsClientIdRule } from "../../../../../src/commands/setup/rules/sso-needs-client-id";

const broken = (flags: Record<string, unknown>) => {
  return ssoNeedsClientIdRule.broken({ flags, args: {}, argv: [] });
};

describe("ssoNeedsClientIdRule", () => {
  it("names where to register an application for a scripted catalog provider", () => {
    expect(broken({ sso: "google", nonInteractive: true })).toEqual({
      registration: expect.stringContaining("an OAuth application at https://"),
    });
  });

  it("names the issuer for a scripted custom provider", () => {
    expect(
      broken({ sso: "custom", nonInteractive: true, ssoIssuer: "https://sso.acme.example" }),
    ).toEqual({ registration: "a client at https://sso.acme.example" });
  });

  it("holds when the client id is given", () => {
    expect(broken({ sso: "google", nonInteractive: true, ssoClientId: "abc" })).toBe(false);
  });

  it("holds without a provider", () => {
    expect(broken({ nonInteractive: true })).toBe(false);
  });

  it("asks for the client id", () => {
    expect(ssoNeedsClientIdRule.refusal.message).toBe("--sso {sso} needs --sso-client-id");
  });
});
