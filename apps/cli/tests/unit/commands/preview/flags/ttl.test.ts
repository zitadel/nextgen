import { describe, expect, it } from "vitest";

import { ttlFlag } from "../../../../../src/commands/preview/flags/ttl";
import { parseFlag } from "../../../../helpers/inputs";

describe("--ttl", () => {
  it.each([
    ["7d", 7 * 24 * 60 * 60 * 1000],
    ["60s", 60 * 1000],
    ["12h", 12 * 60 * 60 * 1000],
    ["365d", 365 * 24 * 60 * 60 * 1000],
  ])("accepts %s", async (value, ms) => {
    await expect(parseFlag(ttlFlag({}), value, "ttl")).resolves.toMatchObject({ ms });
  });

  it.each(["59s", "366d"])("refuses %s as outside the allowed range", async (value) => {
    await expect(parseFlag(ttlFlag({}), value, "ttl")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: `${value} is outside the allowed range`,
    });
  });

  it("refuses what is not a duration", async () => {
    await expect(parseFlag(ttlFlag({}), "soon", "ttl")).rejects.toMatchObject({
      message: "soon is not a valid ttl",
    });
  });
});
