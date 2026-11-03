import { describe, expect, it } from "vitest";

import { followIsNotJsonRule } from "../../../../../src/commands/logs/rules/follow-is-not-json";

function view(flags: Record<string, unknown>) {
  return {
    flags,
    args: {},
    argv: [],
  };
}

describe("followIsNotJsonRule", () => {
  it("is broken when the lines are followed into the envelope", () => {
    expect(followIsNotJsonRule.broken(view({ follow: true, json: true }))).toBe(true);
  });

  it("holds when the lines are only followed", () => {
    expect(followIsNotJsonRule.broken(view({ follow: true, json: false }))).toBe(false);
  });

  it("holds when the envelope is asked for without following", () => {
    expect(followIsNotJsonRule.broken(view({ follow: false, json: true }))).toBe(false);
  });

  it("says to drop one of the two", () => {
    expect(followIsNotJsonRule.refusal).toEqual({
      message: "Cannot stream logs with --json",
      hint: "Run without --json, or omit --follow.",
    });
  });
});
