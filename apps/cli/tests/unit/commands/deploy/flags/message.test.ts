import { describe, expect, it } from "vitest";

import { messageFlag, readMessage } from "../../../../../src/commands/deploy/flags/message";

describe("readMessage", () => {
  it("reads a message trimmed", () => {
    expect(readMessage("  ship it ")).toBe("ship it");
  });

  it("refuses a blank message", () => {
    expect(() => readMessage("   ")).toThrow(expect.objectContaining({ code: "E_VALIDATION" }));
  });

  it("refuses a message longer than the server records, counting characters", () => {
    expect(() => readMessage("é".repeat(1025))).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: "the message is longer than 1024 characters",
        hint: "Pass a shorter summary with -m.",
      }),
    );
    expect(readMessage("é".repeat(1024))).toHaveLength(1024);
  });
});

describe("messageFlag", () => {
  it("is wired to readMessage", async () => {
    const flag = messageFlag({});

    await expect(flag.parse(" ", {} as never, flag as never)).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});
