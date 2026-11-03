import { describe, expect, it } from "vitest";

import {
  originFlag,
  ORIGIN_IS_PRIMARY_REFUSAL,
  readOrigin,
} from "../../../../../src/commands/preview/flags/origin";

describe("readOrigin", () => {
  it("drops trailing slashes, so one preview is one spelling", () => {
    expect(readOrigin("https://pr-1.acme.app//", "--origin")).toBe("https://pr-1.acme.app");
  });

  it.each(["primary", "primary//"])("refuses the primary keyword %j", (value) => {
    expect(() => readOrigin(value, "--origin")).toThrow(ORIGIN_IS_PRIMARY_REFUSAL.message);
  });

  it("refuses a blank value, naming the flag", () => {
    expect(() => readOrigin("  ", "--origin")).toThrow("the value is empty");
  });
});

describe("originFlag", () => {
  it("is wired to the validator", async () => {
    const defined = originFlag({ name: "origin" } as never) as unknown as {
      parse: (input: string, context: never, flag: unknown) => Promise<unknown>;
    };

    expect(await defined.parse("https://a.app/", {} as never, { name: "origin" })).toBe(
      "https://a.app",
    );
  });
});
