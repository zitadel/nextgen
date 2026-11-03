import { describe, expect, it } from "vitest";

import {
  readVariableName,
  VARIABLE_NAME_INVALID_REFUSAL,
  variableNameArg,
} from "../../../../../src/commands/variable/args/name";

describe("readVariableName", () => {
  it.each(["GOOGLE_CLIENT_ID", "a", "_x1", "A".repeat(255)])("accepts %j", (name) => {
    expect(readVariableName(name)).toBe(name);
  });

  it.each(["GOOGLE-CLIENT", "a.b", "has space", ""])(
    "refuses %j as invalid, quoting it",
    (name) => {
      expect(() => readVariableName(name)).toThrow(
        expect.objectContaining({
          code: "E_VALIDATION",
          message: `Invalid variable name "${name}".`,
          hint: VARIABLE_NAME_INVALID_REFUSAL.hint,
        }),
      );
    },
  );

  it("refuses a name past the schema's limit, saying how long it is", () => {
    expect(() => readVariableName("A".repeat(256))).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: "Variable name is 256 characters; the limit is 255.",
        hint: "Shorten the name.",
      }),
    );
  });
});

describe("variableNameArg", () => {
  it("refuses a bad name through the argument", async () => {
    const arg = variableNameArg({}) as unknown as {
      parse: (input: string, context: unknown, arg: unknown) => Promise<string>;
    };

    await expect(arg.parse("a.b", {}, { name: "name" })).rejects.toMatchObject({
      message: 'Invalid variable name "a.b".',
    });
  });
});
