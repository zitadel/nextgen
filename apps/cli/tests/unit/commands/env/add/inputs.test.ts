import { describe, expect, it } from "vitest";

import EnvAdd, { readAppUrl } from "@/commands/env/add/index";
import { parseArg, parseFlag } from "@tests/helpers/inputs";

describe("the environment name argument", () => {
  it.each(["production", "staging-2", "a.b", "team_a"])("accepts %j", async (name) => {
    await expect(parseArg(EnvAdd.args.name, name)).resolves.toBe(name);
  });

  it("accepts one a shell padded with spaces, as the prompt does", async () => {
    await expect(parseArg(EnvAdd.args.name, " production ")).resolves.toBe("production");
  });

  it.each(["../escape", "local", "staging.local", "", "a/b"])(
    "refuses %j, quoting it",
    async (name) => {
      await expect(parseArg(EnvAdd.args.name, name)).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: `"${name}" is not a usable environment name`,
        hint: expect.stringContaining("letters, digits"),
      });
    },
  );
});

describe("readAppUrl, which the prompt reuses", () => {
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

describe("--app-url", () => {
  it("is the URL the flag holds", async () => {
    await expect(
      parseFlag(EnvAdd.flags["app-url"], "https://app.acme.com", "app-url"),
    ).resolves.toBe("https://app.acme.com");
  });

  it("accepts one a shell padded with spaces, as the prompt does", async () => {
    await expect(
      parseFlag(EnvAdd.flags["app-url"], " https://app.acme.com ", "app-url"),
    ).resolves.toBe("https://app.acme.com");
  });

  it.each(["ftp://app.acme.com", "not a url", "  "])("refuses %j, quoting it", async (input) => {
    await expect(parseFlag(EnvAdd.flags["app-url"], input, "app-url")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: `Invalid app URL "${input}"`,
      hint: "Use a URL like https://app.acme.com.",
    });
  });
});
