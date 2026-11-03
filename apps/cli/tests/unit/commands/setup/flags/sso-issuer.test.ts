import { describe, expect, it } from "vitest";

import { ssoIssuerFlag, readSsoIssuer } from "../../../../../src/commands/setup/flags/sso-issuer";

describe("readSsoIssuer", () => {
  it("reads 'https://sso.acme.example' as typed", () => {
    expect(readSsoIssuer("https://sso.acme.example")).toBe("https://sso.acme.example");
  });

  it("refuses 'not a url'", () => {
    expect(() => readSsoIssuer("not a url")).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
        hint: "Fix --sso-issuer and run the command again.",
      }),
    );
  });

  it("refuses a blank value", () => {
    expect(() => readSsoIssuer("  ")).toThrow(expect.objectContaining({ code: "E_VALIDATION" }));
  });
});

describe("ssoIssuerFlag", () => {
  it("is wired to readSsoIssuer", async () => {
    const flag = ssoIssuerFlag({});

    await expect(flag.parse("not a url", {} as never, flag as never)).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});
