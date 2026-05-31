import { describe, expect, it } from "vitest";

import {
  buildUserSchema,
  validateJsonSchema,
  validateUserSchema,
} from "../../../../src/lib/user-schema";

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

describe("validateUserSchema", () => {
  it("accepts a user-schema body with the kind discriminator", () => {
    expect(validateUserSchema({ kind: "user-schema", type: "object" })).toEqual({ valid: true });
  });

  it("accepts a schema-url body", () => {
    expect(validateUserSchema({ kind: "schema-url", url: "https://example/schema" })).toEqual({
      valid: true,
    });
  });

  it("rejects a body missing the kind discriminator", () => {
    const result = validateUserSchema({ type: "object" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toMatch(/kind/);
    }
  });

  it("rejects a body with an unsupported kind value", () => {
    const result = validateUserSchema({ kind: "device-schema", type: "object" });
    expect(result.valid).toBe(false);
  });

  it("rejects a structurally-invalid JSON Schema before checking kind", () => {
    expect(validateUserSchema({ kind: "user-schema", type: 123 })).toMatchObject({ valid: false });
  });
});
