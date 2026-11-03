import { describe, expect, it } from "vitest";

import { ssoScopesFlag, readSsoScopes } from "../../../../../src/commands/setup/flags/sso-scopes";

describe("readSsoScopes", () => {
  it("reads 'openid profile' as typed", () => {
    expect(readSsoScopes("openid profile")).toBe("openid profile");
  });

  it("refuses '   ,  '", () => {
    expect(() => readSsoScopes("   ,  ")).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
        hint: "Fix --sso-scopes and run the command again.",
      }),
    );
  });

  it("refuses a blank value", () => {
    expect(() => readSsoScopes("  ")).toThrow(expect.objectContaining({ code: "E_VALIDATION" }));
  });
});

describe("ssoScopesFlag", () => {
  it("is wired to readSsoScopes", async () => {
    const flag = ssoScopesFlag({});

    await expect(flag.parse("   ,  ", {} as never, flag as never)).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});
