import { CreateTeamBody } from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { describe, expect, it } from "vitest";

import { describeBody } from "../../../../../src/lib/oclif/crud";
import { documentSchemaOf } from "../../../../../src/lib/oclif/crud/fields";
import { resourceBody } from "../../../../../src/lib/oclif/requires/crud";
import type { GlobalOptions } from "../../../../../src/lib/oclif/types";

const requirement = resourceBody({
  topic: "teams",
  verb: "create",
  root: undefined,
  schema: CreateTeamBody,
  document: documentSchemaOf(CreateTeamBody, undefined),
  fields: describeBody(CreateTeamBody),
  references: undefined,
});

const resolve = (flags: Record<string, unknown>) => {
  return requirement.resolve({
    flags,
    args: {},
    meta: {} as GlobalOptions,
    resolved: {},
    connect: () => Promise.reject(new Error("a body needs no connection")),
  });
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

  it("names the required fields a body lacks", async () => {
    await expect(resolve({ data: "{}" })).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("teams create is missing required"),
    });
  });

  it("refuses a body that does not fit the API schema", async () => {
    await expect(resolve({ data: '{"name":42}' })).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});
