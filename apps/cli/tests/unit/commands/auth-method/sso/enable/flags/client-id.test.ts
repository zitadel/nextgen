import { describe, expect, it } from "vitest";

import {
  clientIdFlag,
  readClientId,
} from "../../../../../../../src/commands/auth-method/sso/enable/flags/client-id";

describe("readClientId", () => {
  it("hands the command the client id trimmed", () => {
    expect(readClientId("  abc.apps.googleusercontent.com \n", "--client-id")).toBe(
      "abc.apps.googleusercontent.com",
    );
  });

  it.each(["", "   ", "\n"])("refuses %j as blank, naming the flag", (input) => {
    expect(() => readClientId(input, "--client-id")).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
        hint: expect.stringContaining("--client-id"),
      }),
    );
  });
});

describe("clientIdFlag", () => {
  it("refuses a blank value through the flag", async () => {
    const flag = clientIdFlag({}) as unknown as {
      parse: (input: string, context: unknown, flag: unknown) => Promise<unknown>;
    };

    await expect(flag.parse("   ", {}, { name: "client-id" })).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});
