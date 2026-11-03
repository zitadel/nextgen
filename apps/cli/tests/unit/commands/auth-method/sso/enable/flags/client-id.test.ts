import { describe, expect, it } from "vitest";

import { clientIdFlag } from "../../../../../../../src/commands/auth-method/sso/enable/flags/client-id";
import { parseFlag } from "../../../../../../helpers/inputs";

describe("--client-id", () => {
  it("hands the command the client id trimmed", async () => {
    await expect(
      parseFlag(clientIdFlag({}), "  abc.apps.googleusercontent.com \n", "client-id"),
    ).resolves.toBe("abc.apps.googleusercontent.com");
  });

  it.each(["", "   ", "\n"])("refuses %j as blank, naming the flag", async (input) => {
    await expect(parseFlag(clientIdFlag({}), input, "client-id")).rejects.toMatchObject({
      code: "E_VALIDATION",
      hint: expect.stringContaining("--client-id"),
    });
  });
});
