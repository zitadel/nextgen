import { describe, expect, it } from "vitest";

import { appUrlFlag, readAppUrl } from "../../../../../../src/commands/env/add/flags/app-url";

describe("readAppUrl", () => {
  it("takes an empty answer as none", () => {
    expect(readAppUrl("   ")).toEqual({ ok: true, value: undefined });
  });

  it("takes an http(s) URL as typed", () => {
    expect(readAppUrl(" https://app.acme.com ")).toEqual({
      ok: true,
      value: "https://app.acme.com",
    });
  });

  it.each(["ftp://app.acme.com", "not a url"])("refuses %j with the problem", (answer) => {
    expect(readAppUrl(answer)).toEqual({
      ok: false,
      problem: `Invalid app URL "${answer}"`,
    });
  });
});

describe("appUrlFlag", () => {
  const flag = appUrlFlag({}) as unknown as {
    parse: (input: string, context: unknown, flag: unknown) => Promise<string>;
  };

  it("is the URL the flag holds", async () => {
    await expect(flag.parse("https://app.acme.com", {}, { name: "app-url" })).resolves.toBe(
      "https://app.acme.com",
    );
  });

  it.each(["ftp://app.acme.com", "not a url", "  "])("refuses %j, quoting it", async (input) => {
    await expect(flag.parse(input, {}, { name: "app-url" })).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: `Invalid app URL "${input}"`,
      hint: "Use a URL like https://app.acme.com.",
    });
  });
});
