import { describe, expect, it } from "vitest";

import {
  ENVIRONMENT_NAME_REFUSAL,
  environmentNameArg,
  readEnvironmentName,
} from "../../../../../../src/commands/env/add/args/name";

describe("readEnvironmentName", () => {
  it.each(["production", "staging-2", "a.b", "team_a"])("accepts %j", (name) => {
    expect(readEnvironmentName(name)).toBe(name);
  });

  it.each(["../escape", "local", "staging.local", "", "a/b"])("refuses %j, quoting it", (name) => {
    expect(() => readEnvironmentName(name)).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: `"${name}" is not a usable environment name`,
        hint: ENVIRONMENT_NAME_REFUSAL.hint,
      }),
    );
  });
});

describe("environmentNameArg", () => {
  it("refuses a bad name through the argument", async () => {
    const arg = environmentNameArg({}) as unknown as {
      parse: (input: string, context: unknown, arg: unknown) => Promise<string>;
    };

    await expect(arg.parse("../escape", {}, { name: "name" })).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});
