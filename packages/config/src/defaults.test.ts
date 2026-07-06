import { describe, expect, it } from "vitest";

import {
  defaultHumanUserSchemaUrl,
  getDefaultHumanUserSchema,
  getDefaultLoginFlow,
} from "./defaults";

describe("default config rendering", () => {
  it("trims the schema base when rendering the default user schema URL", () => {
    expect(defaultHumanUserSchemaUrl("https://example.test/api/schemas///")).toBe(
      "https://example.test/api/schemas/default-human-user.json",
    );
  });

  it("substitutes the builtin base and schema URL through default documents", () => {
    const schema = getDefaultHumanUserSchema({
      builtinSchemaBase: "https://example.test/api/schemas/",
    });
    const flow = getDefaultLoginFlow({
      builtinSchemaBase: "https://example.test/api/schemas/",
    });

    expect(schema).toMatchObject({
      title: "DefaultHumanUserSchema",
      metaSchema: "https://example.test/api/schemas/user-schema.json",
      "$id": "https://example.test/api/schemas/default-human-user.json",
      objectType: "human-user",
    });
    expect(flow.user_schema).toBe(
      "https://example.test/api/schemas/default-human-user.json",
    );
  });

  it("pins the flow to a server-assigned schema id when one is provided", () => {
    const flow = getDefaultLoginFlow({ userSchemaUrl: "schema_abc123" });

    expect(flow.user_schema).toBe("schema_abc123");
    expect(flow.status).toBe("active");
  });
});
