import { describe, expect, it } from "vitest";

import { CreateFlowDefinitionBody } from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";

/** The inner flow-definition shape; the envelope is `CreateFlowDefinitionBody`. */
const flowDefinitionSchema = CreateFlowDefinitionBody.shape.flow_definition;

// Setup scaffolds default schema and flow files through the shared config
// package. This file keeps the spec-contract check that flow `fields` must be
// a string[] (not a rich per-field object).
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
