import { CreateTeamBody } from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { describe, expect, it } from "vitest";

import { describeBody } from "../../../../../src/lib/oclif/crud";
import { documentSchemaOf } from "../../../../../src/lib/oclif/crud/fields";
import { refusalError } from "../../../../../src/lib/oclif/refusal";
import { resourceBody } from "../../../../../src/lib/oclif/crud/resource-body";
import { isUnmet } from "../../../../../src/lib/oclif/requirements";
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
    argv: [],
    meta: {} as GlobalOptions,
    resolved: {},
    connect: () => {
      return Promise.reject(new Error("a body needs no connection"));
    },
    suggest: () => {
      throw new Error("a body suggests nothing");
    },
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
    expect(await resolve({ data: "{}" })).toMatchObject({
      unmet: {
        command: "teams create",
        noun: "field",
        names: ["name"],
      },
    });
  });

  it("words the refusal for what it lacks, naming the fields in the error's details", async () => {
    const found = await resolve({ data: "{}" });

    expect(isUnmet(found)).toBe(true);
    const error = refusalError(
      requirement.refusal ?? { message: "" },
      isUnmet(found) ? found.unmet : {},
    );
    expect(error.message).toBe("teams create is missing required field: --name");
    expect(error.hint).toContain("Pass --name, or include it in --data / --file.");
    expect(error.details).toEqual({ missing: ["name"] });
  });

  it("refuses a body that does not fit the API schema", async () => {
    await expect(resolve({ data: '{"name":42}' })).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});
