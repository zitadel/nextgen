import { describe, expect, it } from "vitest";

import { Policy, PolicyTest } from "@/lib/zitadel";
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
 * A test file the policy test contract takes.
 */
const TEST_FILE = {
  operation: OPERATION,
  cases: [
    {
      name: "too short",
      input: { password: "short1" },
      expect: { allowed: false, violations: ["min_length"] },
    },
  ],
};

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

/**
 * A policy test file read from `.zitadel/policies/`.
 *
 * @param name - The file's name.
 * @param body - What it holds.
 * @returns The test file, as read.
 */
function testAt(name: string, body: JsonObject): PolicyTest {
  return PolicyTest.of({ path: `.zitadel/policies/${name}`, body });
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

describe("Policy.asRead", () => {
  it("marks a new policy as read", () => {
    const policy = Policy.create({ path: `.zitadel/policies/${OPERATION}.json`, body: POLICY });

    expect(policy.asRead().status).toBe("read");
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
});

describe("PolicyTest.of", () => {
  it("takes the file as read", () => {
    expect(testAt(`${OPERATION}.test.json`, TEST_FILE).status).toBe("read");
  });
});

describe("PolicyTest.create", () => {
  it("takes the file as new", () => {
    const test = PolicyTest.create({
      path: `.zitadel/policies/${OPERATION}.test.json`,
      body: TEST_FILE,
    });

    expect(test.status).toBe("created");
  });
});

describe("PolicyTest.asRead", () => {
  it("marks a new test file as read", () => {
    const test = PolicyTest.create({
      path: `.zitadel/policies/${OPERATION}.test.json`,
      body: TEST_FILE,
    });

    expect(test.asRead().status).toBe("read");
  });
});

describe("PolicyTest.problems", () => {
  it("finds nothing wrong with a test file named after its operation", () => {
    expect(testAt(`${OPERATION}.test.json`, TEST_FILE).problems({})).toEqual([]);
  });

  it("names the file a test file must have when it has another", () => {
    expect(
      testAt("password.test.json", TEST_FILE)
        .problems({})
        .map((issue) => {
          return issue.message;
        }),
    ).toEqual([`tests the ${OPERATION} policy, so it must be named ${OPERATION}.test.json`]);
  });

  it("reports what the test contract refuses, under contract/policy", () => {
    const test = testAt(`${OPERATION}.test.json`, { operation: OPERATION });

    expect(
      test.problems({}).map((issue) => {
        return issue.rule;
      }),
    ).toEqual(["contract/policy"]);
  });
});

describe("PolicyTest.wireBody", () => {
  it("gives the cases without the $schema pointer", () => {
    const test = testAt(`${OPERATION}.test.json`, {
      $schema: "../meta/policy-test.json",
      ...TEST_FILE,
    });

    expect(test.wireBody(new MemoryStore())).toEqual(TEST_FILE);
  });
});
