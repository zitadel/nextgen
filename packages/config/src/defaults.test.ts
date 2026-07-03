import { describe, expect, it } from "vitest";

import {
  getDefaultHumanUserSchema,
  getDefaultLoginFlow,
  resolveSchemaUrl,
} from "./defaults";

describe("default config rendering", () => {
  it("trims the schema base when composing a resolved schema URL", () => {
    expect(resolveSchemaUrl("sch_abc123", "https://example.test/api/schemas///")).toBe(
      "https://example.test/api/schemas/sch_abc123",
    );
  });

  it("renders the human-user schema with the resolved metaSchema URL and no `$id`", () => {
    const schema = getDefaultHumanUserSchema({
      builtinSchemaBase: "https://example.test/api/schemas/",
    });
    expect(schema).toMatchObject({
      title: "DefaultHumanUserSchema",
      metaSchema: "https://example.test/api/schemas/user-schema.json",
      objectType: "human-user",
    });
    expect(schema).not.toHaveProperty("$id");
  });

  it("stamps the caller-supplied resolved URL onto the flow's user_schema", () => {
    const flow = getDefaultLoginFlow({
      userSchemaUrl: "https://example.test/api/schemas/sch_abc123",
    });
    expect(flow.user_schema).toBe("https://example.test/api/schemas/sch_abc123");
  });
});
