import { describe, expect, it } from "vitest";

import { parseAppUrl } from "../../../../../src/lib/oclif/inputs/environment";
import { parseJson, runCliForTest } from "../../../../helpers/run-cli";

describe("environmentNameArg", () => {
  it("refuses a name that cannot be a file name, quoting it", async () => {
    const result = await runCliForTest(["env", "add", "../escape", "--json"]);

    const json = parseJson(result.stdout) as { code: string; message: string; hint: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toBe('"../escape" is not a usable environment name');
    expect(json.hint).toContain("letters, digits, dot, dash and underscore");
  });

  it("refuses the names that would read another environment's file", async () => {
    for (const name of ["local", "staging.local"]) {
      const result = await runCliForTest(["env", "add", name, "--json"]);

      expect((parseJson(result.stdout) as { code: string }).code).toBe("E_VALIDATION");
    }
  });
});

describe("appUrlFlag", () => {
  it("refuses a value that is not an http(s) URL, quoting it", async () => {
    const result = await runCliForTest([
      "env",
      "add",
      "production",
      "--app-url",
      "ftp://app.acme.com",
      "--json",
    ]);

    const json = parseJson(result.stdout) as { code: string; message: string; hint: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain('Invalid app URL "ftp://app.acme.com"');
    expect(json.hint).toBe("Use a URL like https://app.acme.com.");
  });

  it("refuses a value that is not a URL at all", async () => {
    const result = await runCliForTest([
      "env",
      "add",
      "production",
      "--app-url",
      "not a url",
      "--json",
    ]);

    expect((parseJson(result.stdout) as { code: string }).code).toBe("E_VALIDATION");
  });
});

describe("parseAppUrl", () => {
  it("takes an empty answer as none", () => {
    expect(parseAppUrl("   ")).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("keeps an http(s) URL, trimmed", () => {
    expect(parseAppUrl(" https://app.acme.com ")).toEqual({
      ok: true,
      value: "https://app.acme.com",
    });
  });

  it("refuses anything else with the problem to show beside the prompt", () => {
    expect(parseAppUrl("ftp://app.acme.com")).toEqual({
      ok: false,
      problem: 'Invalid app URL "ftp://app.acme.com"',
    });
  });
});
