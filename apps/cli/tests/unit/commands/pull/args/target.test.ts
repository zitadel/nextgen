import { describe, expect, it } from "vitest";

import {
  classifyTarget,
  LATEST_TARGET,
  readTarget,
  TARGET_REFUSAL,
  targetArg,
} from "../../../../../src/commands/pull/args/target";

describe("classifyTarget", () => {
  it.each([
    ["latest", { kind: "latest" }],
    ["rel_01ABC", { kind: "release", id: "rel_01ABC" }],
    ["dep_01ABC", { kind: "deployment", id: "dep_01ABC" }],
    ["sch_01ABC", { kind: "invalid" }],
    ["human-user", { kind: "invalid" }],
  ])("reads %s", (input, expected) => {
    expect(classifyTarget(input)).toEqual(expected);
  });
});

describe("readTarget", () => {
  it("hands over a classified target", () => {
    expect(readTarget("dep_01ABC")).toEqual({ kind: "deployment", id: "dep_01ABC" });
  });

  it("refuses a target pull cannot read, naming it", () => {
    expect(() => readTarget("sch_01ABC")).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: TARGET_REFUSAL.message.replace("{value}", "sch_01ABC"),
      }),
    );
  });
});

describe("targetArg", () => {
  it("is wired to readTarget", async () => {
    const arg = targetArg();

    await expect(arg.parse("rel_01ABC", {} as never, arg)).resolves.toEqual({
      kind: "release",
      id: "rel_01ABC",
    });
  });

  it("defaults to the live release", () => {
    expect(LATEST_TARGET).toEqual({ kind: "latest" });
  });
});
