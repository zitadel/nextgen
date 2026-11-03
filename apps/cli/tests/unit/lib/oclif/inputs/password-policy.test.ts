import { describe, expect, it } from "vitest";

import { passwordMinLengthFlag } from "../../../../../src/lib/oclif/inputs/password-policy";

async function parse(input: string) {
  const flag = passwordMinLengthFlag({});
  return flag.parse(input, {} as never, flag as never);
}

describe("passwordMinLengthFlag", () => {
  it("reads a whole number", async () => {
    await expect(parse("12")).resolves.toBe(12);
  });

  it("reads 0 as none", async () => {
    await expect(parse("0")).resolves.toBeNull();
  });

  it("refuses a value the policy would not accept, with the parser's reason", async () => {
    await expect(parse("many")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("Must be a whole number from 1 to"),
    });
  });

  it("refuses a blank value", async () => {
    await expect(parse("  ")).rejects.toMatchObject({ code: "E_VALIDATION" });
  });
});
