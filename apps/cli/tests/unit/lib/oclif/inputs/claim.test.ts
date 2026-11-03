import { describe, expect, it } from "vitest";

import { challengeIdRules } from "../../../../../src/lib/oclif/inputs/claim";

function broken(challengeId: unknown): boolean {
  return challengeIdRules.some((rule) => {
    return rule.broken({
      flags: {
        "challenge-id": challengeId,
      },
      args: {},
    });
  });
}

describe("challengeIdRules", () => {
  it("lets an id in the contract's shape and an absent one through", () => {
    expect(broken("ch_01J0Z9KX7Y0Q2Y7JX5M9K2YF3C")).toBe(false);
    expect(broken(undefined)).toBe(false);
  });

  it("refuses anything else, suggesting the step that mints one", () => {
    expect(broken("not-a-challenge")).toBe(true);
    expect(challengeIdRules[0]?.refusal.next).toEqual(["claim --no-wait"]);
  });
});
