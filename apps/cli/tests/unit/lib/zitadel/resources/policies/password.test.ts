import { describe, expect, it } from "vitest";

import { PASSWORD_POLICY_PATH, parsePasswordMinLength, passwordPolicy } from "@/lib/zitadel";

describe("PASSWORD_POLICY_PATH", () => {
  it("is where the policy syncer expects the password policy", () => {
    expect(PASSWORD_POLICY_PATH).toBe(".zitadel/policies/auth.factor.password.set.json");
  });
});

describe("passwordPolicy", () => {
  it("sets the recommended minimum when none was given", () => {
    expect(passwordPolicy().body).toEqual({
      $schema: "../meta/policy.json",
      operation: "auth.factor.password.set",
      config: { min_length: 15 },
    });
  });

  it("enforces nothing for an explicit none", () => {
    expect(passwordPolicy(null).config).toEqual({});
  });

  it("sets the minimum it is given", () => {
    expect(passwordPolicy(12).config).toEqual({ min_length: 12 });
  });

  it("is a new file at the password policy's path", () => {
    const policy = passwordPolicy();

    expect([policy.path, policy.status]).toEqual([PASSWORD_POLICY_PATH, "created"]);
  });

  it("is a policy the contract takes", () => {
    expect(passwordPolicy(12).problems({})).toEqual([]);
  });
});

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
