import { describe, expect, it } from "vitest";

import { ciFlag } from "../../../../../src/lib/telemetry/dimensions/ci-flag";

describe("ciFlag", () => {
  it("detects an automated CI environment", () => {
    expect(ciFlag.value({ GITHUB_ACTIONS: "true" })).toBe(true);
    expect(ciFlag.value({ CI: "1" })).toBe(true);
    expect(ciFlag.value({})).toBe(false);
  });

  it("does not treat a present-but-false CI value as CI", () => {
    expect(ciFlag.value({ CI: "false" })).toBe(false);
    expect(ciFlag.value({ CI: "0" })).toBe(false);
  });
});
