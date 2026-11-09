import { describe, expect, it } from "vitest";

import { BrokenFilesError, Policy } from "@/lib/zitadel";
import { MemoryStore } from "@/lib/zitadel/storage";
import type { JsonObject } from "@/lib/zitadel/types";

/**
 * The operation every policy in these tests is for.
 */
const OPERATION = "auth.factor.password.set";

/**
 * A policy the policy contract takes.
 */
const POLICY = { operation: OPERATION, config: { min_length: 12 } };

/**
 * A policy read from `.zitadel/policies/`.
 *
 * @param name - The file's name.
 * @param body - What it holds.
 * @returns The policy, as read.
 */
function policyAt(name: string, body: JsonObject): Policy {
  return Policy.of({ path: `.zitadel/policies/${name}`, body });
}

describe("Policy.PASSWORD_PATH", () => {
  it("is where the policy syncer expects the password policy", () => {
    expect(Policy.PASSWORD_PATH).toBe(".zitadel/policies/auth.factor.password.set.json");
  });
});

describe("Policy.password", () => {
  describe("when no minimum was given", () => {
    it("sets the recommended minimum", () => {
      expect(Policy.password().body).toEqual({
        $schema: "../meta/policy.json",
        operation: "auth.factor.password.set",
        config: { min_length: 15 },
      });
    });
  });

  describe("with an explicit none", () => {
    it("enforces nothing", () => {
      expect(Policy.password(null).config).toEqual({});
    });
  });

  describe("with a minimum", () => {
    it("sets it", () => {
      expect(Policy.password(12).config).toEqual({ min_length: 12 });
    });

    it("is a policy the contract takes", () => {
      expect(Policy.password(12).problems({})).toEqual([]);
    });
  });

  it("is a new file at the password policy's path", () => {
    const policy = Policy.password();

    expect([policy.path, policy.status]).toEqual([Policy.PASSWORD_PATH, "created"]);
  });
});

describe("Policy.of", () => {
  it("takes the file as read", () => {
    expect(policyAt(`${OPERATION}.json`, POLICY).status).toBe("read");
  });
});

describe("Policy.create", () => {
  it("takes the file as new", () => {
    expect(
      Policy.create({ path: `.zitadel/policies/${OPERATION}.json`, body: POLICY }).status,
    ).toBe("created");
  });
});

describe("Policy.fileName", () => {
  it("names the file after its operation", () => {
    expect(Policy.fileName(OPERATION)).toBe(`${OPERATION}.json`);
  });
});

describe("Policy.operation", () => {
  it("reads the operation the policy guards", () => {
    expect(policyAt(`${OPERATION}.json`, POLICY).operation).toBe(OPERATION);
  });

  it("refuses a body the policy contract refuses", () => {
    const policy = policyAt(`${OPERATION}.json`, { operation: OPERATION });

    expect(() => {
      return policy.operation;
    }).toThrow(BrokenFilesError);
  });
});

describe("Policy.config", () => {
  it("reads the rules without the $schema pointer", () => {
    const policy = policyAt(`${OPERATION}.json`, { $schema: "../meta/policy.json", ...POLICY });

    expect(policy.config).toEqual({ min_length: 12 });
  });

  it("names the file and what the contract refuses in it", () => {
    const policy = policyAt(`${OPERATION}.json`, { ...POLICY, config: { min_length: 0 } });

    expect(() => {
      return policy.config;
    }).toThrow(/\.zitadel\/policies\/auth\.factor\.password\.set\.json: config\.min_length/);
  });
});

describe("Policy.asRead", () => {
  it("marks a new policy as read", () => {
    const policy = Policy.create({ path: `.zitadel/policies/${OPERATION}.json`, body: POLICY });

    expect(policy.asRead().status).toBe("read");
  });
});

describe("Policy.withMinLength", () => {
  const kept = policyAt(`${OPERATION}.json`, {
    $schema: "../meta/policy.json",
    operation: OPERATION,
    config: { min_length: 12, max_length: 40 },
  });

  it.each([
    ["none was given", undefined],
    ["the minimum is already that one", 12],
  ])("keeps the same policy when %s", (_case, minLength) => {
    expect(kept.withMinLength(minLength)).toEqual({ document: kept, changed: false, skipped: [] });
  });

  it("keeps the same policy when none is asked of a policy without a minimum", () => {
    const policy = policyAt(`${OPERATION}.json`, { operation: OPERATION, config: {} });

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

describe("Policy.problems", () => {
  it("finds nothing wrong with a policy named after its operation", () => {
    expect(policyAt(`${OPERATION}.json`, POLICY).problems({})).toEqual([]);
  });

  it("finds nothing wrong with the editor's $schema pointer", () => {
    const policy = policyAt(`${OPERATION}.json`, { $schema: "../meta/policy.json", ...POLICY });

    expect(policy.problems({})).toEqual([]);
  });

  it("names the file a policy must have when it has another", () => {
    expect(policyAt("password.json", POLICY).problems({})).toEqual([
      {
        severity: "error",
        rule: "contract/policy",
        file: ".zitadel/policies/password.json",
        message: `holds the ${OPERATION} policy, so it must be named ${OPERATION}.json`,
      },
    ]);
  });

  it("reports what the policy contract refuses, under contract/policy", () => {
    const policy = policyAt(`${OPERATION}.json`, { ...POLICY, config: { min_length: "twelve" } });

    expect(
      policy.problems({}).map((issue) => {
        return issue.rule;
      }),
    ).toEqual(["contract/policy"]);
  });
});

describe("Policy.wireBody", () => {
  it("sends the operation and its rules without the $schema pointer", () => {
    const policy = policyAt(`${OPERATION}.json`, { $schema: "../meta/policy.json", ...POLICY });

    expect(policy.wireBody(new MemoryStore())).toEqual(POLICY);
  });

  it("sends a body the contract refuses as it is, for the deploy's checks to name", () => {
    const policy = policyAt(`${OPERATION}.json`, { operation: OPERATION });

    expect(policy.wireBody(new MemoryStore())).toEqual({ operation: OPERATION });
  });
});
