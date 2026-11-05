import { CreateTeamBody } from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { describe, expect, it } from "vitest";

import { describeBody } from "@/lib/oclif/crud";
import { documentSchemaOf } from "@/lib/oclif/crud/fields";
import { resourceBody } from "@/lib/oclif/crud/resource-body";

const resolve = (flags: Record<string, unknown>) => {
  return resourceBody(
    {
      topic: "teams",
      verb: "create",
      root: undefined,
      schema: CreateTeamBody,
      document: documentSchemaOf(CreateTeamBody, undefined),
      fields: describeBody(CreateTeamBody),
      references: undefined,
    },
    flags,
  );
};

describe("resourceBody", () => {
  it("builds the body from the document and lets a --set entry win over it", async () => {
    const body = await resolve({
      data: '{"name":"Core","slug":"core"}',
      set: [
        {
          name: "name",
          path: ["name"],
          value: "Platform",
          raw: "name=Platform",
        },
      ],
    });

    expect(body).toMatchObject({ name: "Platform" });
  });

  it("words the refusal for what it lacks, naming the fields in the error's details", async () => {
    await expect(resolve({ data: "{}" })).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "teams create is missing required field: --name",
      hint: expect.stringContaining("Pass --name, or include it in --data / --file."),
      details: {
        missing: ["name"],
      },
    });
  });

  it("refuses a body that does not fit the API schema", async () => {
    await expect(resolve({ data: '{"name":42}' })).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});
