import { describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../../../../helpers/run-cli";

describe("variableNameArg", () => {
  it("refuses a name with a character the platform would refuse, quoting it", async () => {
    const result = await runCliForTest(["variable", "get", "GOOGLE-CLIENT", "--json"]);

    const json = parseJson(result.stdout) as { code: string; message: string; hint: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toBe('Invalid variable name "GOOGLE-CLIENT".');
    expect(json.hint).toBe("A variable name contains only letters, digits and underscores.");
  });

  it("refuses a name past the schema's limit, saying how long it is", async () => {
    const result = await runCliForTest(["variable", "rm", "A".repeat(256), "--json"]);

    const json = parseJson(result.stdout) as { code: string; message: string; hint: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toBe("Variable name is 256 characters; the limit is 255.");
    expect(json.hint).toBe("Shorten the name.");
  });

  it("refuses it on set as well, before the value is asked for", async () => {
    const result = await runCliForTest(["variable", "set", "a.b", "1", "--json"]);

    expect((parseJson(result.stdout) as { message: string }).message).toBe(
      'Invalid variable name "a.b".',
    );
  });
});
