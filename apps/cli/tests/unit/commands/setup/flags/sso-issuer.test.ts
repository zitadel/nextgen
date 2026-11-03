import { describe, expect, it } from "vitest";

import { ssoIssuerFlag } from "../../../../../src/commands/setup/flags/sso-issuer";
import { parseFlag } from "../../../../helpers/inputs";

describe("--sso-issuer", () => {
  it("reads a value the provider could have issued", async () => {
    await expect(
      parseFlag(ssoIssuerFlag({}), "https://sso.acme.example", "sso-issuer"),
    ).resolves.toBe("https://sso.acme.example");
  });

  it("refuses one the provider could not have", async () => {
    await expect(parseFlag(ssoIssuerFlag({}), "not a url", "sso-issuer")).rejects.toMatchObject({
      code: "E_VALIDATION",
      hint: "Fix --sso-issuer and run the command again.",
    });
  });

  it("refuses a blank value", async () => {
    await expect(parseFlag(ssoIssuerFlag({}), "  ", "sso-issuer")).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});
