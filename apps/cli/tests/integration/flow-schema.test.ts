import { describe, expect, it } from "vitest";

import { CreateFlowDefinitionBody } from "@zitadel-nextgen/api/generated/endpoints/zitadelNextGen.zod";

/** The inner flow-definition shape; the envelope is `CreateFlowDefinitionBody`. */
const flowDefinitionSchema = CreateFlowDefinitionBody.shape.flow_definition;

// The default user schema and flow definition are provisioned server-side
// when a project is created, so `setup` no longer scaffolds them locally.
// The builders (`lib/flows`, `lib/user-schema`) and their shapes are covered
// by their own unit tests; this file keeps the spec-contract check that flow
// `fields` must be a string[] (not a rich per-field object).
describe("flow definition schema", () => {
  it("rejects flow definitions with object-shaped fields (spec says fields is string[])", () => {
    const legacy = {
      name: "legacy",
      user_schema: "https://example.com/user.yaml",
      purposes: { login: "identifier" },
      steps: [
        {
          name: "identifier",
          fields: { email: { type: "email" } },
          actions: {},
        },
      ],
    };
    const parsed = flowDefinitionSchema.safeParse(legacy);
    expect(parsed.success).toBe(false);
  });
});
