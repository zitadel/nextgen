import { describe, expect, it } from "vitest";

import { ssoSlugFlag } from "../../../../../src/commands/setup/flags/sso-slug";
import { parseFlag } from "../../../../helpers/inputs";

describe("--sso-slug", () => {
  it("reads a value the provider could have issued", async () => {
    await expect(parseFlag(ssoSlugFlag({}), "acme-sso", "sso-slug")).resolves.toBe("acme-sso");
  });

  it("refuses one the provider could not have", async () => {
    await expect(parseFlag(ssoSlugFlag({}), "Not A Slug!", "sso-slug")).rejects.toMatchObject({
      code: "E_VALIDATION",
      hint: "Fix --sso-slug and run the command again.",
    });
  });

  it("refuses a blank value", async () => {
    await expect(parseFlag(ssoSlugFlag({}), "  ", "sso-slug")).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});
