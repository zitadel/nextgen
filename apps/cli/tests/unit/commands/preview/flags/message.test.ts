import { describe, expect, it } from "vitest";

import {
  messageFlag,
  MESSAGE_TOO_LONG_REFUSAL,
  readMessage,
} from "../../../../../src/commands/preview/flags/message";
import { interpolate } from "../../../../../src/lib/oclif/refusal";

describe("readMessage", () => {
  it("trims a message", () => {
    expect(readMessage("  add company  ")).toBe("add company");
  });

  it("refuses a blank message", () => {
    expect(() => readMessage("   ")).toThrow("the value is empty");
  });

  it("refuses a message longer than the server records, naming the limit", () => {
    expect(() => readMessage("x".repeat(1025))).toThrow(
      interpolate(MESSAGE_TOO_LONG_REFUSAL.message, { limit: 1024 }),
    );
  });

  it("counts code points, not UTF-16 units", () => {
    expect(readMessage("😀".repeat(1024))).toHaveLength(2048);
  });
});

describe("messageFlag", () => {
  it("is wired to the validator", async () => {
    const defined = messageFlag("A message.") as unknown as {
      parse: (input: string, context: never, flag: unknown) => Promise<unknown>;
    };

    expect(await defined.parse(" hi ", {} as never, { name: "message" })).toBe("hi");
  });
});
