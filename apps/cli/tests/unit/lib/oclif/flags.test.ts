import { describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../../../helpers/run-cli";

/**
 * `required: true` asks only whether a token reached argv, and an empty one
 * satisfies it — `--flag "$VAR"` with `VAR` unset sends exactly that. These
 * pin the refusal that oclif's own `required` does not perform.
 */
describe("a flag that must not be blank", () => {
  it("refuses an empty value, where oclif's own check passes it", async () => {
    const result = await runCliForTest([
      "sso",
      "enable",
      "--provider",
      "google",
      "--client-id",
      "",
      "--json",
    ]);

    expect(result.exitCode).not.toBe(0);
    const json = parseJson(result.stdout) as { code: string; hint?: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.hint).toContain("--client-id");
  });

  it("refuses a value that is only whitespace", async () => {
    const result = await runCliForTest([
      "sso",
      "enable",
      "--provider",
      "google",
      "--client-id",
      "   ",
      "--json",
    ]);

    expect((parseJson(result.stdout) as { code: string }).code).toBe("E_VALIDATION");
  });

  it("still refuses a missing value the way oclif always did", async () => {
    // Unquoted `--client-id $UNSET` drops the word entirely; that path was
    // never broken and must keep its own wording.
    const result = await runCliForTest([
      "sso",
      "enable",
      "--provider",
      "google",
      "--client-id",
      "--json",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect((parseJson(result.stdout) as { message: string }).message).toContain("expects a value");
  });
});

describe("an argument that must not be blank", () => {
  it("refuses an empty name before the command runs", async () => {
    const result = await runCliForTest(["variables", "get", "", "--project-level", "--json"]);

    expect(result.exitCode).not.toBe(0);
    const json = parseJson(result.stdout) as { code: string; message: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("empty value");
  });

  it("leaves a real name alone, trimmed", async () => {
    // Reaching the owner check means the argument parsed; the point is that
    // a padded value is not refused and arrives without its padding.
    const result = await runCliForTest(["variables", "get", "  FOO  ", "--json"]);

    expect((parseJson(result.stdout) as { message: string }).message).toContain("Name the owner");
  });
});
