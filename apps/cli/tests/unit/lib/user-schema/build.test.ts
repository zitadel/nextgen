import { describe, expect, it } from "vitest";

import { buildUserSchema } from "../../../../src/lib/user-schema";

describe("buildUserSchema", () => {
  it("uses project-scoped uniqueness for email and sorts required", () => {
    const schema = buildUserSchema("passkey", ["email", "given_name", "family_name"]);
    expect(schema.properties.email?.["x-unique"]).toBe("project");
    expect(schema.required).toEqual(["email", "family_name", "given_name"]);
  });

  it("records the chosen method as the sole x-auth-methods entry", () => {
    const schema = buildUserSchema("passkey", ["email"]);
    expect(Object.keys(schema["x-auth-methods"])).toEqual(["passkey"]);
    expect(schema["x-auth-methods"].passkey).toEqual({ enabled: true, position: 0 });
  });

  it("returns a freshly allocated object on every call", () => {
    const a = buildUserSchema("password", ["email"]);
    const b = buildUserSchema("password", ["email"]);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
