import { describe, expect, it } from "vitest";

import { originFlag } from "../../../../../src/commands/preview/flags/origin";
import { parseFlag } from "../../../../helpers/inputs";

describe("--origin", () => {
  it("drops trailing slashes, so one preview is one spelling", async () => {
    await expect(parseFlag(originFlag({}), "https://pr-1.acme.app//", "origin")).resolves.toBe(
      "https://pr-1.acme.app",
    );
  });

  it.each(["primary", "primary//"])("refuses the primary keyword %j", async (value) => {
    await expect(parseFlag(originFlag({}), value, "origin")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "A preview cannot target the primary origins",
    });
  });

  it("refuses a blank value, naming the flag", async () => {
    await expect(parseFlag(originFlag({}), "  ", "origin")).rejects.toMatchObject({
      code: "E_VALIDATION",
      hint: expect.stringContaining("--origin"),
    });
  });
});
