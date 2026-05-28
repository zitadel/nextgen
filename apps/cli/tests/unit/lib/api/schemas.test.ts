import { describe, expect, it } from "vitest";

import { environmentSchema } from "../../../../src/lib/api/schemas";

describe("environmentSchema", () => {
  it.each(["development", "preview", "production"])("parses the valid environment %s", (value) => {
    expect(environmentSchema.parse(value)).toBe(value);
  });

  it("rejects an unknown environment string", () => {
    const result = environmentSchema.safeParse("staging");
    expect(result.success).toBe(false);
  });

  it("rejects a non-string value", () => {
    const result = environmentSchema.safeParse(42);
    expect(result.success).toBe(false);
  });

  it("rejects an empty string", () => {
    const result = environmentSchema.safeParse("");
    expect(result.success).toBe(false);
  });
});
