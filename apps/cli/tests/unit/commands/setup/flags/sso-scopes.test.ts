import { describe, expect, it } from "vitest";

import { ssoScopesFlag } from "../../../../../src/commands/setup/flags/sso-scopes";
import { parseFlag } from "../../../../helpers/inputs";

describe("--sso-scopes", () => {
  it("reads a value the provider could have issued", async () => {
    await expect(parseFlag(ssoScopesFlag({}), "openid profile", "sso-scopes")).resolves.toBe(
      "openid profile",
    );
  });

  it("refuses one the provider could not have", async () => {
    await expect(parseFlag(ssoScopesFlag({}), "   ,  ", "sso-scopes")).rejects.toMatchObject({
      code: "E_VALIDATION",
      hint: "Fix --sso-scopes and run the command again.",
    });
  });

  it("refuses a blank value", async () => {
    await expect(parseFlag(ssoScopesFlag({}), "  ", "sso-scopes")).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});
