import { describe, expect, it } from "vitest";

import { envEnabled } from "../../../../../src/lib/telemetry/dimensions/env-flag";

describe("envEnabled", () => {
  it("treats present, truthy values as enabled", () => {
    expect(envEnabled("true")).toBe(true);
    expect(envEnabled("1")).toBe(true);
    expect(envEnabled("anything")).toBe(true);
  });

  it("treats unset and present-but-falsey values as disabled", () => {
    expect(envEnabled(undefined)).toBe(false);
    expect(envEnabled("")).toBe(false);
    expect(envEnabled("false")).toBe(false);
    expect(envEnabled("0")).toBe(false);
    expect(envEnabled(" Off ")).toBe(false);
    expect(envEnabled("no")).toBe(false);
  });
});
