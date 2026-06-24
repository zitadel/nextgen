import { describe, expect, it } from "vitest";

import { resolveConsent } from "../../../../src/lib/telemetry/consent";

describe("resolveConsent", () => {
  it("is enabled by default and returns the resolved token", () => {
    const consent = resolveConsent({ env: {} });
    expect(consent).toMatchObject({ enabled: true, reason: "enabled" });
    expect(consent.token).toBeTruthy();
  });

  it("honors --no-telemetry above everything else", () => {
    expect(resolveConsent({ env: {}, flag: false })).toEqual({
      enabled: false,
      reason: "flag-opt-out",
    });
  });

  it("honors DO_NOT_TRACK for any value other than 0", () => {
    expect(resolveConsent({ env: { DO_NOT_TRACK: "1" } }).reason).toBe("do-not-track");
    expect(resolveConsent({ env: { DO_NOT_TRACK: "true" } }).reason).toBe("do-not-track");
  });

  it("treats DO_NOT_TRACK=0 as not opting out", () => {
    expect(resolveConsent({ env: { DO_NOT_TRACK: "0" } }).enabled).toBe(true);
  });

  it("honors ZITADEL_TELEMETRY falsey tokens, including an explicit empty value", () => {
    for (const value of ["", "0", "false", "off", "no", "OFF"]) {
      expect(resolveConsent({ env: { ZITADEL_TELEMETRY: value } }).reason).toBe("env-opt-out");
    }
  });

  it("disables under the test runner", () => {
    expect(resolveConsent({ env: { VITEST: "true" } }).reason).toBe("test-runner");
    expect(resolveConsent({ env: { NODE_ENV: "test" } }).reason).toBe("test-runner");
  });

  it("is enabled on the production channel (production token is configured)", () => {
    expect(resolveConsent({ env: { ZITADEL_TELEMETRY_ENV: "production" } })).toMatchObject({
      enabled: true,
      reason: "enabled",
    });
  });

  it("lets an explicit token override re-enable a build", () => {
    expect(
      resolveConsent({
        env: { ZITADEL_TELEMETRY_ENV: "production", ZITADEL_TELEMETRY_TOKEN: "tok" },
      }).enabled,
    ).toBe(true);
  });
});
