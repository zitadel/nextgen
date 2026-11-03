import { describe, expect, it } from "vitest";

import { LATEST_TARGET, targetArg } from "../../../../../src/commands/pull/args/target";
import { parseArg } from "../../../../helpers/inputs";

describe("the pull target argument", () => {
  it.each([
    ["latest", { kind: "latest" }],
    ["rel_01ABC", { kind: "release", id: "rel_01ABC" }],
    ["dep_01ABC", { kind: "deployment", id: "dep_01ABC" }],
  ])("hands over %s classified", async (input, expected) => {
    await expect(parseArg(targetArg({}), input, "target")).resolves.toEqual(expected);
  });

  it.each(["sch_01ABC", "human-user"])(
    "refuses %s, which pull cannot read, naming it",
    async (input) => {
      await expect(parseArg(targetArg({}), input, "target")).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: `Don't know how to pull "${input}".`,
      });
    },
  );

  it("defaults to the live release", () => {
    expect(LATEST_TARGET).toEqual({ kind: "latest" });
  });
});
