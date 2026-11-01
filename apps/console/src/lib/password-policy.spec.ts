import { describe, expect, it } from "vitest";

import { passwordRequirements } from "./password-policy";

describe("password requirements", () => {
  it("states the rules in force, and flags a minimum under fifteen", () => {
    expect(passwordRequirements({ min_length: 15, history_depth: 4 })).toEqual({
      minimumLength: "15 characters",
      minimumSet: true,
      belowRecommended: false,
      history: "Prevent reuse of the last 4 passwords",
    });
    expect(passwordRequirements({ min_length: 1, history_depth: 1 })).toEqual({
      minimumLength: "1 character",
      minimumSet: true,
      belowRecommended: true,
      history: "Prevent reuse of the last password",
    });
  });

  it("reads a rule the config leaves out, or no policy at all, as what is allowed", () => {
    expect(passwordRequirements({})).toEqual({
      minimumLength: "No minimum",
      minimumSet: false,
      belowRecommended: true,
      history: "Reuse allowed",
    });
    expect(passwordRequirements(undefined)).toEqual(passwordRequirements({}));
  });
});
