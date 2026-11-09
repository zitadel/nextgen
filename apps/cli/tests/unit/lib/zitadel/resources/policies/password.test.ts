import { describe, expect, it } from "vitest";

import { PasswordPolicy } from "@/lib/zitadel";

/**
 * The operation the password policy guards.
 */
const OPERATION = "auth.factor.password.set";

describe("PasswordPolicy.PATH", () => {
  it("is where the policy syncer expects the password policy", () => {
    expect(PasswordPolicy.PATH).toBe(".zitadel/policies/auth.factor.password.set.json");
  });
});

describe("PasswordPolicy.initial", () => {
  describe("when no minimum was given", () => {
    it("sets the recommended minimum", () => {
      expect(PasswordPolicy.initial().body).toEqual({
        $schema: "../meta/policy.json",
        operation: "auth.factor.password.set",
        config: { min_length: 15 },
      });
    });
  });

  describe("with an explicit none", () => {
    it("enforces nothing", () => {
      expect(PasswordPolicy.initial(null).config).toEqual({});
    });
  });

  describe("with a minimum", () => {
    it("sets it", () => {
      expect(PasswordPolicy.initial(12).config).toEqual({ min_length: 12 });
    });

    it("is a policy the contract takes", () => {
      expect(PasswordPolicy.initial(12).problems({})).toEqual([]);
    });
  });

  it("is a new file at the password policy's path", () => {
    const policy = PasswordPolicy.initial();

    expect([policy.path, policy.status]).toEqual([PasswordPolicy.PATH, "created"]);
  });
});

describe("PasswordPolicy.minLength", () => {
  describe("with a minimum", () => {
    it("is that minimum", () => {
      expect(PasswordPolicy.initial(12).minLength).toBe(12);
    });
  });

  describe("with an explicit none", () => {
    it("is undefined", () => {
      expect(PasswordPolicy.initial(null).minLength).toBeUndefined();
    });
  });
});

describe("PasswordPolicy.parseMinLength", () => {
  it.each([
    ["", null],
    ["  ", null],
    ["0", null],
    ["00", null],
    ["1", 1],
    ["15", 15],
    ["64", 64],
  ])("reads %j as %j", (text, value) => {
    expect(PasswordPolicy.parseMinLength(text)).toEqual({ ok: true, value });
  });

  it.each(["65", "12.5", "-3", "twelve", "1e1"])("refuses %j with the contract's bounds", (text) => {
    expect(PasswordPolicy.parseMinLength(text)).toEqual({
      ok: false,
      problem: "Must be a whole number from 1 to 64, or 0 for none",
    });
  });
});

describe("PasswordPolicy.withMinLength", () => {
  const kept = PasswordPolicy.of({
    path: PasswordPolicy.PATH,
    body: {
    $schema: "../meta/policy.json",
    operation: OPERATION,
    config: { min_length: 12, max_length: 40 },
    },
  });

  it.each([
    ["none was given", undefined],
    ["the minimum is already that one", 12],
  ])("keeps the same policy when %s", (_case, minLength) => {
    expect(kept.withMinLength(minLength)).toEqual({ document: kept, changed: false, skipped: [] });
  });

  it("keeps the same policy when none is asked of a policy without a minimum", () => {
    const policy = PasswordPolicy.of({
      path: PasswordPolicy.PATH,
      body: { operation: OPERATION, config: {} },
    });

    expect(policy.withMinLength(null)).toEqual({ document: policy, changed: false, skipped: [] });
  });

  it("drops the minimum for an explicit none, keeping the other settings", () => {
    expect(kept.withMinLength(null).document.body).toEqual({
      $schema: "../meta/policy.json",
      operation: OPERATION,
      config: { max_length: 40 },
    });
  });

  it("sets a new minimum, keeping the other settings", () => {
    expect(kept.withMinLength(20).document.config).toEqual({ min_length: 20, max_length: 40 });
  });

  it("marks a read policy as edited", () => {
    expect(kept.withMinLength(20).document.status).toBe("edited");
  });
});
