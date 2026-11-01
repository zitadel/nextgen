import { CreateSchemaBody } from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { describe, expect, it } from "vitest";

import {
  defaultHumanUserSchemaUrl,
  SETUP_PRESETS,
  SETUP_USE_CASES,
  getDefaultHumanUserSchema,
  getDefaultHumanUserSchemaBody,
  getDefaultLoginFlow,
} from "./defaults";

describe("default config rendering", () => {
  it("trims the schema base when rendering the default user schema URL", () => {
    expect(defaultHumanUserSchemaUrl("https://example.test/api/schemas///")).toBe(
      "https://example.test/api/schemas/default-human-user.json",
    );
  });

  it("substitutes the builtin base and names the schema by objectType in the flow", () => {
    const schema = getDefaultHumanUserSchema({
      builtinSchemaBase: "https://example.test/api/schemas/",
    });
    const flow = getDefaultLoginFlow({
      builtinSchemaBase: "https://example.test/api/schemas/",
    });

    expect(schema).toMatchObject({
      title: "DefaultHumanUserSchema",
      metaSchema: "https://example.test/api/schemas/user-schema.json",
      $id: "https://example.test/api/schemas/default-human-user.json",
      objectType: "human-user",
    });
    expect(flow.user_schema).toBe("human-user");
    expect(flow.status).toBe("active");
  });

  it("leaves the template's $id out of the schema's create body", () => {
    const body = getDefaultHumanUserSchemaBody();

    expect(body).not.toHaveProperty("$id");
  });

  it("keeps the rest of the template in the schema's create body", () => {
    const { $id: _templateId, ...template } = getDefaultHumanUserSchema();
    void _templateId;

    expect(getDefaultHumanUserSchemaBody()).toEqual(template);
  });

  it.each(SETUP_PRESETS.flatMap((preset) => SETUP_USE_CASES.map((useCase) => [preset, useCase])))(
    "renders the %s %s schema as a user schema document the create body takes",
    (preset, useCase) => {
      const schema = getDefaultHumanUserSchema({ preset, useCase });

      expect(CreateSchemaBody.safeParse(schema).success).toBe(true);
      expect(schema).toMatchObject({ kind: "user-schema", $id: expect.any(String) });
    },
  );
});
