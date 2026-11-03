import { describe, expect, it } from "vitest";

import {
  ssoDisplayNameFlag,
  readSsoDisplayName,
} from "../../../../../src/commands/setup/flags/sso-display-name";

describe("readSsoDisplayName", () => {
  it("reads 'Acme SSO' as typed", () => {
    expect(readSsoDisplayName("Acme SSO")).toBe("Acme SSO");
  });

  it("refuses 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'", () => {
    expect(() =>
      readSsoDisplayName(
        "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      ),
    ).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
        hint: "Fix --sso-display-name and run the command again.",
      }),
    );
  });

  it("refuses a blank value", () => {
    expect(() => readSsoDisplayName("  ")).toThrow(
      expect.objectContaining({ code: "E_VALIDATION" }),
    );
  });
});

describe("ssoDisplayNameFlag", () => {
  it("is wired to readSsoDisplayName", async () => {
    const flag = ssoDisplayNameFlag({});

    await expect(
      flag.parse(
        "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        {} as never,
        flag as never,
      ),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});
