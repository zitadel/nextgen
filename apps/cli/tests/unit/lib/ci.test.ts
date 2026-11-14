import { describe, expect, it } from "vitest";

import { isCI } from "@/lib/ci";

describe("isCI", () => {
  it.each(["true", "1", "yes", "github"])("is CI when CI is %j", (value) => {
    expect(isCI({ CI: value })).toBe(true);
  });

  it.each(["", "0", "false"])("is not CI when CI is %j", (value) => {
    expect(isCI({ CI: value })).toBe(false);
  });

  it("is not CI when CI is not set", () => {
    expect(isCI({})).toBe(false);
  });
});
