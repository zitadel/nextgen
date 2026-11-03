import { describe, expect, it } from "vitest";

import { urlArg } from "../../../../../src/commands/preview/args/url";
import { parseArg } from "../../../../helpers/inputs";

describe("the preview url argument", () => {
  it("drops a trailing slash, which would match no preview", async () => {
    await expect(parseArg(urlArg({}), "https://pr-1.acme.app//", "url")).resolves.toBe(
      "https://pr-1.acme.app",
    );
  });

  it("refuses an empty value, naming the argument", async () => {
    await expect(parseArg(urlArg({}), "", "url")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "url was given an empty value",
    });
  });
});
