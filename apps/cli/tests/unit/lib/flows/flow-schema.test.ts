import { describe, expect, it } from "vitest";

import { CreateFlowDefinitionBody } from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";

/** The inner flow-definition shape; the envelope is `CreateFlowDefinitionBody`. */
const flowDefinitionSchema = CreateFlowDefinitionBody.shape.flow_definition;

/** A flow definition whose single step declares `fields` in the given shape. */
function withFields(fields: unknown) {
  return {
    name: "legacy",
    user_schema: "https://example.com/user.yaml",
    purposes: { login: "identifier" },
    steps: [{ name: "identifier", fields, actions: {} }],
  };
}

/** The issues the schema raises about that step's `fields`, if any. */
function fieldsIssues(fields: unknown): string[] {
  const parsed = flowDefinitionSchema.safeParse(withFields(fields));
  if (parsed.success) {
    return [];
  }
  return parsed.error.issues
    .filter((issue) => issue.path.join(".").includes("fields"))
    .map((issue) => issue.path.join("."));
}

describe("flow definition schema", () => {
  it("rejects object-shaped step fields, which the spec says is a string[]", () => {
    expect(fieldsIssues({ email: { type: "email" } })).not.toEqual([]);
  });

  it("accepts a list of field names", () => {
    expect(fieldsIssues(["email"])).toEqual([]);
  });
});
