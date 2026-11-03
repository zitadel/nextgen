import { describe, expect, it } from "vitest";

import { ApiError } from "@zitadel/api/runtime/fetch";

import { previewSecret } from "../../../../../../src/commands/variable/set/requirements/preview-secret";
import { requirementContext } from "../../../../../helpers/requirement-context";

function connectedTo(getVariables: () => Promise<Record<string, { primary?: unknown }>>) {
  return {
    ...requirementContext({
      args: { name: "API_KEY" },
      flags: { preview: true, secret: false },
    }),
    connect: async () => {
      return { client: { getVariables }, projectId: "proj_1" } as never;
    },
  };
}

describe("previewSecret", () => {
  it("checks nothing for a write that is not a plain preview value", async () => {
    const found = await previewSecret.resolve(
      requirementContext({ args: { name: "API_KEY" }, flags: { preview: false } }),
    );

    expect(found).toEqual({ checked: false });
  });

  it("passes a name whose primary value is plain", async () => {
    const found = await previewSecret.resolve(
      connectedTo(async () => {
        return { API_KEY: { primary: "x" } };
      }),
    );

    expect(found).toEqual({ checked: true });
  });

  it("refuses a name whose primary value is a secret, suggesting the piped form", async () => {
    await expect(
      previewSecret.resolve(
        connectedTo(async () => {
          return { API_KEY: { primary: { secret: true } } };
        }),
      ),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "API_KEY is a secret, so its preview value must be one too.",
      nextCommands: [expect.stringContaining("variable set API_KEY --secret --preview")],
    });
  });

  it("leaves the check to whoever can read the primary values on a 403", async () => {
    const found = await previewSecret.resolve(
      connectedTo(async () => {
        throw Object.assign(Object.create(ApiError.prototype), { status: 403 });
      }),
    );

    expect(found).toEqual({ checked: true });
  });

  it("fails on any other error, since writing on an unknown is the outcome it guards against", async () => {
    await expect(
      previewSecret.resolve(
        connectedTo(async () => {
          throw new Error("boom");
        }),
      ),
    ).rejects.toThrow("boom");
  });
});
