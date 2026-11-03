import { describe, expect, it } from "vitest";

import { readTtl, ttlFlag } from "../../../../../src/commands/preview/flags/ttl";

describe("readTtl", () => {
  it.each([
    ["7d", 7 * 24 * 60 * 60 * 1000],
    ["60s", 60 * 1000],
    ["365d", 365 * 24 * 60 * 60 * 1000],
  ])("accepts %s", (value, ms) => {
    expect(readTtl(value)).toMatchObject({ ms });
  });

  it.each(["59s", "366d"])("refuses %s as outside the allowed range", (value) => {
    expect(() => readTtl(value)).toThrow(`${value} is outside the allowed range`);
  });

  it("refuses what is not a duration", () => {
    expect(() => readTtl("soon")).toThrow("soon is not a valid ttl");
  });
});

describe("ttlFlag", () => {
  it("is wired to the validator", async () => {
    const defined = ttlFlag({ name: "ttl" } as never) as unknown as {
      parse: (input: string, context: never, flag: unknown) => Promise<unknown>;
    };

    expect(await defined.parse("12h", {} as never, { name: "ttl" })).toMatchObject({
      ms: 12 * 60 * 60 * 1000,
    });
  });
});
