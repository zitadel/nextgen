import { describe, expect, it } from "vitest";

import { apiOperation } from "../../../../../src/commands/api/requirements/operation";
import { requirementContext } from "../../../../helpers/requirement-context";

function chosen(operation: string | undefined, method?: string) {
  return apiOperation.resolve(
    requirementContext({
      args: {
        operation,
      },
      flags: {
        method,
      },
    }),
  );
}

describe("the operation zitadel api is pointed at", () => {
  it("is none when none is named, so a person is asked to choose", async () => {
    await expect(chosen(undefined)).resolves.toEqual({ target: undefined });
  });

  it("is the operation an id names", async () => {
    await expect(chosen("getProject")).resolves.toMatchObject({
      target: {
        operation: {
          id: "getProject",
        },
      },
    });
  });

  it("refuses one the CLI cannot call, saying why", async () => {
    const refused = (await chosen("startSession")) as { unmet?: { reason?: string } };

    expect(refused.unmet?.reason).toEqual(expect.any(String));
  });
});
