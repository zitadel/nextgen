import { describe, expect, it } from "vitest";

import { ssoDisplayNameFlag } from "../../../../../src/commands/setup/flags/sso-display-name";
import { parseFlag } from "../../../../helpers/inputs";

describe("--sso-display-name", () => {
  it("reads a value the provider could have issued", async () => {
    await expect(parseFlag(ssoDisplayNameFlag({}), "Acme SSO", "sso-display-name")).resolves.toBe(
      "Acme SSO",
    );
  });

  it("refuses one the provider could not have", async () => {
    await expect(
      parseFlag(ssoDisplayNameFlag({}), "x".repeat(257), "sso-display-name"),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      hint: "Fix --sso-display-name and run the command again.",
    });
  });

  it("refuses a blank value", async () => {
    await expect(parseFlag(ssoDisplayNameFlag({}), "  ", "sso-display-name")).rejects.toMatchObject(
      {
        code: "E_VALIDATION",
      },
    );
  });
});
