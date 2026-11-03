import { describe, expect, it } from "vitest";

import { environmentNameArg } from "../../../../../../src/commands/env/add/args/name";
import { parseArg } from "../../../../../helpers/inputs";

describe("the environment name argument", () => {
  it.each(["production", "staging-2", "a.b", "team_a"])("accepts %j", async (name) => {
    await expect(parseArg(environmentNameArg({}), name)).resolves.toBe(name);
  });

  it.each(["../escape", "local", "staging.local", "", "a/b"])(
    "refuses %j, quoting it",
    async (name) => {
      await expect(parseArg(environmentNameArg({}), name)).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: `"${name}" is not a usable environment name`,
        hint: expect.stringContaining("letters, digits"),
      });
    },
  );
});
