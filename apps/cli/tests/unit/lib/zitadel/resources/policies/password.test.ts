import { describe, expect, it } from "vitest";

import { PasswordPolicy } from "@/lib/zitadel";
import { aPasswordPolicy } from "@tests/helpers/config";

/**
 * The editor's pointer at the policy meta-schema.
 */
const POINTER = "../meta/policy.json";

/**
 * A password policy as read, requiring twelve characters and at most forty.
 */
const KEPT = PasswordPolicy.of({
  path: PasswordPolicy.PATH,
  body: { $schema: POINTER, ...aPasswordPolicy({ min_length: 12, max_length: 40 }) },
});

describe("PasswordPolicy.PATH", () => {
  it("is where the policy syncer expects the password policy", () => {
    const path = PasswordPolicy.PATH;

    expect(path).toBe(".zitadel/policies/auth.factor.password.set.json");
  });
});

describe("PasswordPolicy.initial", () => {
  it("is a new file at the password policy's path", () => {
    const policy = PasswordPolicy.initial();

    expect(policy).toMatchObject({ path: PasswordPolicy.PATH, status: "created" });
  });

  describe("when no minimum was given", () => {
    it("sets the recommended minimum", () => {
      const policy = PasswordPolicy.initial();

      expect(policy.body).toEqual({ $schema: POINTER, ...aPasswordPolicy({ min_length: 15 }) });
    });
  });

  describe("with an explicit none", () => {
    it("enforces nothing", () => {
      const policy = PasswordPolicy.initial(null);

      expect(policy.config).toEqual({});
    });
  });

  describe("with a minimum", () => {
    it("sets it", () => {
      const policy = PasswordPolicy.initial(12);

      expect(policy.config).toEqual({ min_length: 12 });
    });

    it("is a policy the contract takes", () => {
      const policy = PasswordPolicy.initial(12);

      expect(policy.check({})).toEqual([]);
    });
  });
});

describe("PasswordPolicy.minLength", () => {
  describe("with a minimum", () => {
    it("is that minimum", () => {
      const policy = PasswordPolicy.initial(12);

      const minimum = policy.minLength;

      expect(minimum).toBe(12);
    });
  });

  describe("with an explicit none", () => {
    it("is undefined", () => {
      const policy = PasswordPolicy.initial(null);

      const minimum = policy.minLength;

      expect(minimum).toBeUndefined();
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
    const parsed = PasswordPolicy.parseMinLength(text);

    expect(parsed).toEqual({ ok: true, value });
  });

  it.each(["65", "12.5", "-3", "twelve", "1e1"])(
    "refuses %j with the contract's bounds",
    (text) => {
      const parsed = PasswordPolicy.parseMinLength(text);

      expect(parsed).toEqual({
        ok: false,
        problem: "Must be a whole number from 1 to 64, or 0 for none",
      });
    },
  );
});

describe("PasswordPolicy.withMinLength", () => {
  it.each([
    ["none was given", undefined],
    ["the minimum is already that one", 12],
  ])("keeps the same policy when %s", (_case, minLength) => {
    const edit = KEPT.withMinLength(minLength);

    expect(edit).toEqual({ document: KEPT, changed: false, skipped: [] });
  });

  it("keeps the same policy when none is asked of a policy without a minimum", () => {
    const policy = PasswordPolicy.of({ path: PasswordPolicy.PATH, body: aPasswordPolicy({}) });

    const edit = policy.withMinLength(null);

    expect(edit).toEqual({ document: policy, changed: false, skipped: [] });
  });

  it("drops the minimum for an explicit none, keeping the other settings", () => {
    const edit = KEPT.withMinLength(null);

    expect(edit.document.body).toEqual({
      $schema: POINTER,
      ...aPasswordPolicy({ max_length: 40 }),
    });
  });

  it("sets a new minimum, keeping the other settings", () => {
    const edit = KEPT.withMinLength(20);

    expect(edit.document.config).toEqual({ min_length: 20, max_length: 40 });
  });

  it("marks a read policy as edited", () => {
    const edit = KEPT.withMinLength(20);

    expect(edit.document.status).toBe("edited");
  });
});
