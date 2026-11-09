import { describe, expect, it } from "vitest";

import { CONFIG_DIRECTORIES, Policy, SignupPolicy } from "@/lib/zitadel";
import { aConfig, aPasswordPolicy, PASSWORD_POLICY } from "@tests/helpers/config";
import {
  aPolicyTest,
  PASSWORD_POLICY_FILE,
  PASSWORD_POLICY_TEST_FILE,
  TOO_SHORT_CASE,
} from "@tests/helpers/policies";

/**
 * Where the password policy sits.
 */
const POLICY_PATH = `${CONFIG_DIRECTORIES.policies}/${PASSWORD_POLICY_FILE}`;

/**
 * Where the password policy's test file sits.
 */
const TEST_PATH = `${CONFIG_DIRECTORIES.policies}/${PASSWORD_POLICY_TEST_FILE}`;

/**
 * An operation no policy file in these tests is for.
 */
const UNKNOWN = "auth.unknown";

describe("Policies.password", () => {
  it("is the policy at the password policy's file", () => {
    const config = aConfig({ policies: { [PASSWORD_POLICY_FILE]: aPasswordPolicy({}) } });

    const policy = config.policies.password;

    expect(policy?.path).toBe(POLICY_PATH);
  });

  it("is undefined when the project has none", () => {
    const config = aConfig({ policies: { "other.json": aPasswordPolicy({}) } });

    const policy = config.policies.password;

    expect(policy).toBeUndefined();
  });
});

describe("Policies.signup", () => {
  it("is the policy at the sign-up policy's file", () => {
    const config = aConfig({
      policies: {
        [Policy.fileName(SignupPolicy.OPERATION)]: {
          operation: SignupPolicy.OPERATION,
          config: { challenge: "zitadel_pow" },
        },
      },
    });

    const policy = config.policies.signup;

    expect(policy?.path).toBe(SignupPolicy.PATH);
    expect(policy?.config).toEqual({ challenge: "zitadel_pow" });
  });

  it("is undefined when the project has none", () => {
    const config = aConfig({ policies: { [PASSWORD_POLICY_FILE]: aPasswordPolicy({}) } });

    const policy = config.policies.signup;

    expect(policy).toBeUndefined();
  });
});

describe("Policies.selectPolicies", () => {
  it("holds each sound policy file, without the test files", () => {
    const config = aConfig({
      policies: {
        [PASSWORD_POLICY_FILE]: aPasswordPolicy(),
        [PASSWORD_POLICY_TEST_FILE]: aPolicyTest(),
      },
    });

    const { documents, issues } = config.policies.selectPolicies();

    expect(issues).toEqual([]);
    expect(
      documents.map((policy) => {
        return [policy.path, policy.operation, policy.config];
      }),
    ).toEqual([[POLICY_PATH, PASSWORD_POLICY, { min_length: 12 }]]);
  });

  it("reports an invalid policy file rather than leaving it out", () => {
    const config = aConfig({
      policies: { [PASSWORD_POLICY_FILE]: aPasswordPolicy({ min_length: 0 }) },
    });

    const { documents, issues } = config.policies.selectPolicies();

    expect(documents).toEqual([]);
    expect(issues).toEqual([expect.stringContaining(`${POLICY_PATH}: config.min_length`)]);
  });

  it("reports the problems in code-unit path order, whatever the locale", () => {
    const config = aConfig({
      policies: { "a.json": aPasswordPolicy({}), "B.json": aPasswordPolicy({}) },
    });

    const { issues } = config.policies.selectPolicies();

    expect(
      issues.map((issue) => {
        return issue.split(":")[0];
      }),
    ).toEqual([`${CONFIG_DIRECTORIES.policies}/B.json`, `${CONFIG_DIRECTORIES.policies}/a.json`]);
  });

  it("reports a policy file not named after its operation", () => {
    const config = aConfig({ policies: { "password.json": aPasswordPolicy({}) } });

    const { issues } = config.policies.selectPolicies();

    expect(issues).toEqual([
      `${CONFIG_DIRECTORIES.policies}/password.json: holds the ${PASSWORD_POLICY} policy, so it must be named ${PASSWORD_POLICY_FILE}`,
    ]);
  });

  it("never reads another operation's policy file when one is asked for", () => {
    const config = aConfig({
      policies: {
        [PASSWORD_POLICY_FILE]: aPasswordPolicy(),
        "scratch.json": { operation: UNKNOWN, config: { nope: true } },
      },
    });

    const { documents, issues } = config.policies.selectPolicies([PASSWORD_POLICY]);

    expect(issues).toEqual([]);
    expect(
      documents.map((policy) => {
        return policy.operation;
      }),
    ).toEqual([PASSWORD_POLICY]);
  });

  it("holds nothing for an operation without a policy file", () => {
    const config = aConfig();

    const policies = config.policies.selectPolicies([PASSWORD_POLICY]);

    expect(policies).toEqual({ documents: [], issues: [] });
  });
});

describe("Policies.selectTests", () => {
  it("holds only the test files", () => {
    const config = aConfig({
      policies: {
        [PASSWORD_POLICY_FILE]: aPasswordPolicy({}),
        [PASSWORD_POLICY_TEST_FILE]: aPolicyTest(),
      },
    });

    const { documents, issues } = config.policies.selectTests();

    expect(issues).toEqual([]);
    expect(
      documents.map((test) => {
        return [test.path, test.operation, test.cases];
      }),
    ).toEqual([[TEST_PATH, PASSWORD_POLICY, [TOO_SHORT_CASE]]]);
  });

  it("names an operation asked for that has no test file", () => {
    const config = aConfig({ policies: { [PASSWORD_POLICY_TEST_FILE]: aPolicyTest() } });

    const { documents, issues } = config.policies.selectTests([UNKNOWN]);

    expect(documents).toEqual([]);
    expect(issues).toEqual([`${CONFIG_DIRECTORIES.policies}/${UNKNOWN}.test.json does not exist`]);
  });

  it("never reads another operation's test file when one is asked for", () => {
    const config = aConfig({
      policies: {
        [PASSWORD_POLICY_TEST_FILE]: aPolicyTest(),
        "scratch.test.json": { cases: "not a test" },
      },
    });

    const { documents, issues } = config.policies.selectTests([PASSWORD_POLICY]);

    expect(issues).toEqual([]);
    expect(
      documents.map((test) => {
        return test.operation;
      }),
    ).toEqual([PASSWORD_POLICY]);
  });

  it("names a test file not named after its operation", () => {
    const config = aConfig({ policies: { "password.test.json": aPolicyTest() } });

    const { documents, issues } = config.policies.selectTests();

    expect(documents).toEqual([]);
    expect(issues).toEqual([
      `${CONFIG_DIRECTORIES.policies}/password.test.json: tests the ${PASSWORD_POLICY} policy, so it must be named ${PASSWORD_POLICY_TEST_FILE}`,
    ]);
  });

  it("names the file and the path of what the schema refuses", () => {
    const config = aConfig({
      policies: {
        [PASSWORD_POLICY_TEST_FILE]: aPolicyTest([{ ...TOO_SHORT_CASE, input: { passwd: "x" } }]),
      },
    });

    const { issues } = config.policies.selectTests();

    expect(issues).toEqual([
      expect.stringContaining(`${TEST_PATH}: cases.0.input.password `),
      expect.stringContaining(`${TEST_PATH}: cases.0.input `),
    ]);
  });
});

describe("Policies.remove", () => {
  it("deletes the file of a test file, as it does a policy's", () => {
    const config = aConfig({
      policies: {
        [PASSWORD_POLICY_FILE]: aPasswordPolicy(),
        [PASSWORD_POLICY_TEST_FILE]: aPolicyTest(),
      },
    });

    const change = config.policies.remove(TEST_PATH);

    expect(change.removedPaths).toEqual([TEST_PATH]);
    expect(change.after.policies.tests).toEqual([]);
  });

  it("leaves the policy beside a removed test file", () => {
    const config = aConfig({
      policies: {
        [PASSWORD_POLICY_FILE]: aPasswordPolicy(),
        [PASSWORD_POLICY_TEST_FILE]: aPolicyTest(),
      },
    });

    const change = config.policies.remove(TEST_PATH);

    expect(change.after.policies.paths).toEqual([POLICY_PATH]);
  });

  it("changes nothing for a path no file is at", () => {
    const config = aConfig({ policies: { [PASSWORD_POLICY_TEST_FILE]: aPolicyTest() } });

    const change = config.policies.remove(POLICY_PATH);

    expect(change.changed).toBe(false);
  });
});
