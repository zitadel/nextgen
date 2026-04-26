import { describe, expect, it } from "vitest";

import { defaultUserSchema } from "../../src/schema/default";
import { addFields, parseAddFieldSpec, removeFields } from "../../src/schema/merge";

describe("user schema", () => {
  it("uses project-scoped uniqueness for email", () => {
    const schema = defaultUserSchema();
    expect(schema.properties.email["x-unique"]).toBe("project");
    expect(schema.required).toEqual(["email", "family_name", "given_name"]);
  });

  it("adds and removes fields with stable output", () => {
    const schema = defaultUserSchema();
    const withPhone = addFields(schema, [parseAddFieldSpec("phone:string:format=phone,x-mfa=sms")]);
    expect((withPhone.properties as Record<string, Record<string, unknown>>).phone["x-mfa"]).toBe("sms");
    const removed = removeFields(withPhone, ["family_name"]);
    expect((removed.properties as Record<string, unknown>).family_name).toBeUndefined();
    expect(removed.required).not.toContain("family_name");
  });
});
