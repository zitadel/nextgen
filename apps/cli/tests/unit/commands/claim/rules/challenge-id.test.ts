import { describe, expect, it } from "vitest";

import { challengeIdRule } from "../../../../../src/commands/claim/rules/challenge-id";

describe("--challenge-id", () => {
  const broken = (challengeId: unknown) => {
    return challengeIdRule.broken({ flags: { challengeId }, args: {}, argv: [] });
  };

  it.each(["challenge", "", "ch_"])("refuses %j, which is not a challenge id", (value) => {
    expect(broken(value)).toBe(true);
  });

  it("lets an id in the contract's shape and an absent one through", () => {
    expect(broken("ch_01J0Z9KX7Y0Q2Y7JX5M9K2YF3C")).toBe(false);
    expect(broken(undefined)).toBe(false);
  });

  it("refuses anything else, suggesting the step that mints one", () => {
    expect(broken("not-a-challenge")).toBe(true);
    expect(challengeIdRule.refusal.next).toEqual(["claim --no-wait"]);
  });
});
