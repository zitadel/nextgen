import { describe, expect, it } from "vitest";

import {
  PASSWORD_POLICY_PATH,
  parsePasswordMinLength,
  passwordPolicyFile,
} from "../../../../src/lib/policies";

describe("parsePasswordMinLength", () => {
  it.each([
    // "None" is an answer of its own, apart from not being asked at all.
    ["", null],
    ["  ", null],
    // A minimum of 0 enforces nothing: it means none, never a stored 0.
    ["0", null],
    ["00", null],
    ["1", 1],
    ["15", 15],
    ["64", 64],
  ])("reads %j as %j", (text, value) => {
    expect(parsePasswordMinLength(text)).toEqual({ ok: true, value });
  });

  it.each(["65", "12.5", "-3", "twelve", "1e1"])("refuses %j", (text) => {
    expect(parsePasswordMinLength(text)).toMatchObject({
      ok: false,
      problem: "Must be a whole number from 1 to 64, or 0 for none",
    });
  });
});

describe("passwordPolicyFile", () => {
  it("enforces nothing without a minimum, or with an explicit none", () => {
    expect(passwordPolicyFile(null).config).toEqual({});
    expect(passwordPolicyFile()).toEqual({
      $schema: "../meta/policy.json",
      operation: "auth.factor.password.set",
      config: {},
    });
  });

  it("sets the minimum it is given", () => {
    expect(passwordPolicyFile(12).config).toEqual({ min_length: 12 });
  });

  it("is written where the policy syncer expects it", () => {
    expect(PASSWORD_POLICY_PATH).toBe(".zitadel/policies/auth.factor.password.set.json");
  });
});
