import { describe, expect, it } from "vitest";

import { type JsonObject, ZitadelConfig } from "@/lib/zitadel";

/**
 * The operation every policy in these tests is for.
 */
const OPERATION = "auth.factor.password.set";

/**
 * A case the policy test contract takes.
 */
const CASE = {
  name: "too short",
  input: { password: "short1" },
  expect: { allowed: false, violations: ["min_length"] },
};

/**
 * A test file the policy test contract takes.
 */
const TEST_FILE = { operation: OPERATION, cases: [CASE] };

/**
 * The configuration holding these files under `.zitadel/policies/`.
 *
 * @param files - Each file's body, by its name.
 * @returns The configuration.
 */
function project(files: Record<string, JsonObject>): ZitadelConfig {
  return ZitadelConfig.of({
    schemas: [],
    flows: [],
    connections: [],
    policies: Object.entries(files).map(([name, body]) => {
      return { path: `.zitadel/policies/${name}`, body };
    }),
    branding: [],
  });
}

describe("Policies.password", () => {
  it("is the policy at the password policy's file", () => {
    const config = project({ [`${OPERATION}.json`]: { operation: OPERATION, config: {} } });

    expect(config.policies.password?.path).toBe(`.zitadel/policies/${OPERATION}.json`);
  });

  it("is undefined when the project has none", () => {
    const config = project({ "other.json": { operation: OPERATION, config: {} } });

    expect(config.policies.password).toBeUndefined();
  });
});

describe("Policies.selectPolicies", () => {
  it("holds each sound policy file, without the test files", () => {
    const config = project({
      [`${OPERATION}.json`]: { operation: OPERATION, config: { min_length: 12 } },
      [`${OPERATION}.test.json`]: TEST_FILE,
    });

    const { documents, issues } = config.policies.selectPolicies();

    expect([
      issues,
      documents.map((policy) => {
        return [policy.path, policy.readOperation(), policy.readConfig()];
      }),
    ]).toEqual([[], [[`.zitadel/policies/${OPERATION}.json`, OPERATION, { min_length: 12 }]]]);
  });

  it("reports an invalid policy file rather than leaving it out", () => {
    const config = project({
      [`${OPERATION}.json`]: { operation: OPERATION, config: { min_length: 0 } },
    });

    const { documents, issues } = config.policies.selectPolicies();

    expect([documents, issues]).toEqual([
      [],
      [
        expect.stringMatching(
          /^\.zitadel\/policies\/auth\.factor\.password\.set\.json: config\.min_length/,
        ),
      ],
    ]);
  });

  it("reports a policy file not named after its operation", () => {
    const config = project({ "password.json": { operation: OPERATION, config: {} } });

    const { issues } = config.policies.selectPolicies();

    expect(issues).toEqual([
      `.zitadel/policies/password.json: holds the ${OPERATION} policy, so it must be named ${OPERATION}.json`,
    ]);
  });

  it("never reads another operation's policy file when one is asked for", () => {
    const config = project({
      [`${OPERATION}.json`]: { operation: OPERATION, config: { min_length: 12 } },
      "scratch.json": { operation: "auth.unknown", config: { nope: true } },
    });

    const { documents, issues } = config.policies.selectPolicies([OPERATION]);

    expect([
      issues,
      documents.map((policy) => {
        return policy.readOperation();
      }),
    ]).toEqual([[], [OPERATION]]);
  });

  it("holds nothing for an operation without a policy file", () => {
    const config = project({});

    expect(config.policies.selectPolicies([OPERATION])).toEqual({ documents: [], issues: [] });
  });
});

describe("Policies.selectTests", () => {
  it("holds only the test files", () => {
    const config = project({
      [`${OPERATION}.json`]: { operation: OPERATION, config: {} },
      [`${OPERATION}.test.json`]: TEST_FILE,
    });

    const { documents, issues } = config.policies.selectTests();

    expect([
      issues,
      documents.map((test) => {
        return [test.path, test.readOperation(), test.readCases()];
      }),
    ]).toEqual([[], [[`.zitadel/policies/${OPERATION}.test.json`, OPERATION, [CASE]]]]);
  });

  it("names an operation asked for that has no test file", () => {
    const config = project({ [`${OPERATION}.test.json`]: TEST_FILE });

    const { documents, issues } = config.policies.selectTests(["auth.unknown"]);

    expect([documents, issues]).toEqual([
      [],
      [".zitadel/policies/auth.unknown.test.json does not exist"],
    ]);
  });

  it("never reads another operation's test file when one is asked for", () => {
    const config = project({
      [`${OPERATION}.test.json`]: TEST_FILE,
      "scratch.test.json": { cases: "not a test" },
    });

    const { documents, issues } = config.policies.selectTests([OPERATION]);

    expect([
      issues,
      documents.map((test) => {
        return test.readOperation();
      }),
    ]).toEqual([[], [OPERATION]]);
  });

  it("names a test file not named after its operation", () => {
    const config = project({ "password.test.json": TEST_FILE });

    const { documents, issues } = config.policies.selectTests();

    expect([documents, issues]).toEqual([
      [],
      [
        `.zitadel/policies/password.test.json: tests the ${OPERATION} policy, so it must be named ${OPERATION}.test.json`,
      ],
    ]);
  });

  it("names the file and the path of what the schema refuses", () => {
    const config = project({
      [`${OPERATION}.test.json`]: { ...TEST_FILE, cases: [{ ...CASE, input: { passwd: "x" } }] },
    });

    const { issues } = config.policies.selectTests();

    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue).toMatch(
        /^\.zitadel\/policies\/auth\.factor\.password\.set\.test\.json: cases\.0\.input/,
      );
    }
  });
});
