import { describe, expect, it } from "vitest";

import { buildUserSchema, validateJsonSchema } from "../../../../src/lib/user-schema";

describe("validateJsonSchema", () => {
  it("accepts a freshly built user schema", () => {
    const result = validateJsonSchema(buildUserSchema("passkey", ["email"]));
    expect(result.valid).toBe(true);
  });

  it("reports errors for a structurally invalid schema", () => {
    const result = validateJsonSchema({ type: 123 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});
