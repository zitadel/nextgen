import { describe, expect, it } from "vitest";

import { DEFAULT_USER_META_SCHEMA, buildUserSchema } from "../../../../src/lib/user-schema";

describe("buildUserSchema", () => {
  it("uses project-scoped uniqueness for email and sorts required (with password appended)", () => {
    const schema = buildUserSchema(["email", "given_name", "family_name"]);
    expect(schema.properties?.email?.["x-unique"]).toBe("project");
    expect(schema.required).toEqual(["email", "family_name", "given_name", "password"]);
  });

  it("records password as the sole x-auth-methods entry", () => {
    const schema = buildUserSchema(["email"]);
    expect(Object.keys(schema["x-auth-methods"])).toEqual(["password"]);
    expect(schema["x-auth-methods"].password).toEqual({ enabled: true, position: 0 });
  });

  it("appends a password property with x-password: true (the engine's password marker)", () => {
    const schema = buildUserSchema(["email"]);
    expect(schema.properties?.password?.["x-password"]).toBe(true);
  });

  it("returns a freshly allocated object on every call", () => {
    const a = buildUserSchema(["email"]);
    const b = buildUserSchema(["email"]);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("emits the metaSchema field required by POST /schemas", () => {
    const schema = buildUserSchema(["email"]);
    expect(schema.metaSchema).toBe(DEFAULT_USER_META_SCHEMA);
  });
});
