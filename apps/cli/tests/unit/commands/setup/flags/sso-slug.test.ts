import { describe, expect, it } from "vitest";

import { ssoSlugFlag, readSsoSlug } from "../../../../../src/commands/setup/flags/sso-slug";

describe("readSsoSlug", () => {
  it("reads 'acme-sso' as typed", () => {
    expect(readSsoSlug("acme-sso")).toBe("acme-sso");
  });

  it("refuses 'Not A Slug!'", () => {
    expect(() => readSsoSlug("Not A Slug!")).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
        hint: "Fix --sso-slug and run the command again.",
      }),
    );
  });

  it("refuses a blank value", () => {
    expect(() => readSsoSlug("  ")).toThrow(expect.objectContaining({ code: "E_VALIDATION" }));
  });
});

describe("ssoSlugFlag", () => {
  it("is wired to readSsoSlug", async () => {
    const flag = ssoSlugFlag({});

    await expect(flag.parse("Not A Slug!", {} as never, flag as never)).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});
