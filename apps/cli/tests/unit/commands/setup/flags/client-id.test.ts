import { describe, expect, it } from "vitest";

import { clientIdFlag } from "../../../../../src/commands/setup/flags/client-id";
import { parseFlag } from "../../../../helpers/inputs";

describe("--sso-client-id", () => {
  it("reads a client id trimmed", async () => {
    await expect(parseFlag(clientIdFlag({}), "  abc123  ", "sso-client-id")).resolves.toBe(
      "abc123",
    );
  });

  it("refuses a blank value", async () => {
    await expect(parseFlag(clientIdFlag({}), "  ", "sso-client-id")).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});
