import { describe, expect, it } from "vitest";

import { clientIdFlag } from "../../../../../src/lib/oclif/inputs/idp";

async function parse(input: string): Promise<unknown> {
  const flag = clientIdFlag({}) as unknown as {
    parse: (input: string, context: unknown, flag: unknown) => Promise<unknown>;
  };
  return flag.parse(input, {}, { name: "client-id" });
}

describe("clientIdFlag", () => {
  it("hands the command the client id trimmed", async () => {
    expect(await parse("  abc.apps.googleusercontent.com \n")).toBe(
      "abc.apps.googleusercontent.com",
    );
  });

  it("refuses a blank value, naming the flag", async () => {
    await expect(parse("   ")).rejects.toMatchObject({
      code: "E_VALIDATION",
      hint: expect.stringContaining("--client-id"),
    });
  });
});
