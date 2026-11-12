import { describe, expect, it } from "vitest";

import { variableNameArg } from "@/commands/variable/name";
import { parseArg } from "@tests/helpers/inputs";

describe("the variable name argument", () => {
  it.each(["GOOGLE_CLIENT_ID", "a", "_x1", "A".repeat(255)])("accepts %j", async (name) => {
    await expect(parseArg(variableNameArg({}), name)).resolves.toBe(name);
  });

  it("trims a padded name, as the prompt would have", async () => {
    await expect(parseArg(variableNameArg({}), "  FOO  ")).resolves.toBe("FOO");
  });

  it.each(["GOOGLE-CLIENT", "a.b", "has space", "A\u001b[2J"])(
    "refuses %j as invalid, quoting it as typed",
    async (name) => {
      await expect(parseArg(variableNameArg({}), name)).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: `Invalid variable name "${name}".`,
        hint: "A variable name contains only letters, digits and underscores.",
      });
    },
  );

  it("refuses an empty name, naming the argument it was given for", async () => {
    await expect(parseArg(variableNameArg({}), "")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "name was given an empty value",
    });
  });

  it("refuses a name past the schema's limit, saying how long it is", async () => {
    await expect(parseArg(variableNameArg({}), "A".repeat(256))).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "Variable name is 256 characters; the limit is 255.",
      hint: "Shorten the name.",
    });
  });
});
