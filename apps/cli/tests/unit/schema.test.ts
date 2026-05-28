import { describe, expect, it } from "vitest";

import { buildUserSchema } from "../../src/lib/user-schema";

describe("user schema", () => {
  it("uses project-scoped uniqueness for email", () => {
    const schema = buildUserSchema();
    expect(schema.properties.email?.["x-unique"]).toBe("project");
    expect(schema.required).toEqual(["email", "family_name", "given_name"]);
  });

  it("normalizes a single auth method to a one-entry x-auth-methods map", () => {
    const schema = buildUserSchema({ fields: ["email"], authMethods: "passkey" });
    expect(Object.keys(schema["x-auth-methods"])).toEqual(["passkey"]);
    expect(schema["x-auth-methods"].passkey).toEqual({ enabled: true, position: 0 });
  });
});
