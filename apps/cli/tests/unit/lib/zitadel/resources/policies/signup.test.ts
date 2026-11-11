import { describe, expect, it } from "vitest";

import { SignupPolicy } from "@/lib/zitadel";

/**
 * The editor's pointer at the policy meta-schema.
 */
const POINTER = "../meta/policy.json";

describe("SignupPolicy.PATH", () => {
  it("is where the policy syncer expects the sign-up policy", () => {
    const path = SignupPolicy.PATH;

    expect(path).toBe(".zitadel/policies/user.create.json");
  });
});

describe("SignupPolicy.initial", () => {
  it("is a new file at the sign-up policy's path", () => {
    const policy = SignupPolicy.initial();

    expect(policy).toMatchObject({ path: SignupPolicy.PATH, status: "created" });
  });

  it("names the server's own challenge, the built-in proof of work", () => {
    const policy = SignupPolicy.initial();

    expect(policy.body).toEqual({
      $schema: POINTER,
      operation: "user.create",
      config: { challenge: "zitadel_pow" },
    });
  });

  it("is a policy the contract takes", () => {
    const policy = SignupPolicy.initial();

    expect(policy.check({})).toEqual([]);
  });
});
