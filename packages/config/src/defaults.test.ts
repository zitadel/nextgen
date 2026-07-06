import { describe, expect, it } from "vitest";

import { getDefaultHumanUserSchema, getDefaultLoginFlow } from "./defaults";

describe("default config rendering", () => {
  it("renders the human-user schema with the canonical builtin metaSchema URI and no `$id`", () => {
    const schema = getDefaultHumanUserSchema();
    expect(schema).toMatchObject({
      title: "DefaultHumanUserSchema",
      metaSchema: "https://nextgen.com/api/schemas/user-schema.json",
      objectType: "human-user",
    });
    expect(schema).not.toHaveProperty("$id");
  });

  it("stamps the caller-supplied schema ref onto the flow's user_schema", () => {
    const flow = getDefaultLoginFlow({ userSchemaRef: "sch_01KWHF" });
    expect(flow.user_schema).toBe("sch_01KWHF");
  });
});
