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

describe("Policy.readOperation", () => {
  it("reads the operation the policy guards", () => {
    expect(policyAt(`${OPERATION}.json`, POLICY).readOperation()).toBe(OPERATION);
  });

  it("refuses a body the policy contract refuses", () => {
    const policy = policyAt(`${OPERATION}.json`, { operation: OPERATION });

    expect(() => {
      return policy.readOperation();
    }).toThrow(BrokenFilesError);
  });
});

describe("Policy.readConfig", () => {
  it("reads the rules without the $schema pointer", () => {
    const policy = policyAt(`${OPERATION}.json`, { $schema: "../meta/policy.json", ...POLICY });

    expect(policy.readConfig()).toEqual({ min_length: 12 });
  });

  it("names the file and what the contract refuses in it", () => {
    const policy = policyAt(`${OPERATION}.json`, { ...POLICY, config: { min_length: 0 } });

    expect(() => {
      return policy.readConfig();
    }).toThrow(/\.zitadel\/policies\/auth\.factor\.password\.set\.json: config\.min_length/);
  });
});

describe("Policy.asRead", () => {
  it("marks a new policy as read", () => {
    const policy = Policy.create({ path: `.zitadel/policies/${OPERATION}.json`, body: POLICY });

    expect(policy.markRead().status).toBe("read");
  });
});

describe("Policy.problems", () => {
  it("finds nothing wrong with a policy named after its operation", () => {
    expect(policyAt(`${OPERATION}.json`, POLICY).check({})).toEqual([]);
  });

  it("finds nothing wrong with the editor's $schema pointer", () => {
    const policy = policyAt(`${OPERATION}.json`, { $schema: "../meta/policy.json", ...POLICY });

    expect(policy.check({})).toEqual([]);
  });

  it("names the file a policy must have when it has another", () => {
    expect(policyAt("password.json", POLICY).check({})).toEqual([
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
      policy.check({}).map((issue) => {
        return issue.rule;
      }),
    ).toEqual(["contract/policy"]);
  });
});

describe("Policy.wireBody", () => {
  it("sends the operation and its rules without the $schema pointer", () => {
    const policy = policyAt(`${OPERATION}.json`, { $schema: "../meta/policy.json", ...POLICY });

    expect(policy.toWireBody(new MemoryStore())).toEqual(POLICY);
  });

  it("sends a body the contract refuses as it is, for the deploy's checks to name", () => {
    const policy = policyAt(`${OPERATION}.json`, { operation: OPERATION });

    expect(policy.toWireBody(new MemoryStore())).toEqual({ operation: OPERATION });
  });
});
