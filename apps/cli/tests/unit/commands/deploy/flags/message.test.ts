import { describe, expect, it } from "vitest";

import { messageFlag } from "../../../../../src/commands/deploy/flags/message";
import { parseFlag } from "../../../../helpers/inputs";

const message = () => {
  return messageFlag({});
};

describe("-m", () => {
  it("trims a message", async () => {
    await expect(parseFlag(message(), "  ship it  ", "message")).resolves.toBe("ship it");
  });

  it("refuses a blank message", async () => {
    await expect(parseFlag(message(), "   ", "message")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "the value is empty",
    });
  });

  it("refuses a message longer than the server records, naming the limit", async () => {
    await expect(parseFlag(message(), "x".repeat(1025), "message")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "the message is longer than 1024 characters",
      hint: "Pass a shorter summary with -m.",
    });
  });

  it("counts code points, not UTF-16 units", async () => {
    await expect(parseFlag(message(), "\u{1F600}".repeat(1024), "message")).resolves.toHaveLength(
      2048,
    );
  });
});
