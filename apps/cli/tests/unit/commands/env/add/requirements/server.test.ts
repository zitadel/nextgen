import { describe, expect, it } from "vitest";

import { givenServer } from "../../../../../../src/commands/env/add/requirements/server";
import { requirementContext } from "../../../../../helpers/requirement-context";

describe("givenServer", () => {
  it("is nothing when no server was named", async () => {
    expect(await givenServer.resolve(requirementContext())).toEqual({ value: undefined });
  });

  it("is the origin of the server that was named", async () => {
    const found = await givenServer.resolve(
      requirementContext({ meta: { serverFlag: "https://api.example.com/path" } }),
    );

    expect(found).toEqual({ value: "https://api.example.com" });
  });

  it("refuses a server that is not an http(s) URL", async () => {
    await expect(
      givenServer.resolve(requirementContext({ meta: { serverFlag: "not a url" } })),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
  });
});
