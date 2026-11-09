import { describe, expect, it } from "vitest";

import {
  BrokenFile,
  BrokenFilesError,
  CONFIG_DIRECTORIES,
  MemoryStore,
  PolicyTest,
} from "@/lib/zitadel";
import { aFile, PASSWORD_POLICY } from "@tests/helpers/config";
import { aPolicyTest, PASSWORD_POLICY_TEST_FILE, TOO_SHORT_CASE } from "@tests/helpers/policies";
import { thrownBy } from "@tests/helpers/thrown-value";

/**
 * Where the password policy's test file sits.
 */
const PATH = `${CONFIG_DIRECTORIES.policies}/${PASSWORD_POLICY_TEST_FILE}`;

/**
 * A case expecting a password to be allowed.
 */
const LONG_ENOUGH_CASE = { ...TOO_SHORT_CASE, name: "long enough", expect: { allowed: true } };

/**
 * What the server decides for a password the policy refused for being too
 * short.
 */
const TOO_SHORT = {
  allowed: false,
  code: "user.password_policy_violation",
  violations: { min_length: 12 },
};

describe("PolicyTest.read", () => {
  it("takes a test file the policy test contract takes as a test file", () => {
    const reading = PolicyTest.read(aFile("policies", PASSWORD_POLICY_TEST_FILE, aPolicyTest()));

    expect(reading).toBeInstanceOf(PolicyTest);
  });

  it("takes a test file the policy test contract refuses as a broken file", () => {
    const reading = PolicyTest.read(
      aFile("policies", PASSWORD_POLICY_TEST_FILE, { operation: PASSWORD_POLICY }),
    );

    expect(reading).toBeInstanceOf(BrokenFile);
  });

  it("reports what the test contract refuses, under contract/policy", () => {
    const reading = PolicyTest.read(
      aFile("policies", PASSWORD_POLICY_TEST_FILE, { operation: PASSWORD_POLICY }),
    );

    expect(reading).toMatchObject({ issues: [{ rule: "contract/policy" }] });
  });
});

describe("PolicyTest.of", () => {
  it("takes the file as read", () => {
    const test = PolicyTest.of(aFile("policies", PASSWORD_POLICY_TEST_FILE, aPolicyTest()));

    expect(test.status).toBe("read");
  });

  it("refuses a body the policy test contract refuses", () => {
    const file = aFile("policies", PASSWORD_POLICY_TEST_FILE, { operation: PASSWORD_POLICY });

    const error = thrownBy(() => {
      return PolicyTest.of(file);
    });

    expect(error).toBeInstanceOf(BrokenFilesError);
    expect(error).toMatchObject({ problems: [{ path: PATH }] });
  });

  it("names the file and what the contract refuses in it", () => {
    const file = aFile(
      "policies",
      PASSWORD_POLICY_TEST_FILE,
      aPolicyTest([{ ...TOO_SHORT_CASE, input: { passwd: "x" } }]),
    );

    const error = thrownBy(() => {
      return PolicyTest.of(file);
    });

    expect(error).toMatchObject({ message: expect.stringContaining(`${PATH}: cases.0.input`) });
  });
});

describe("PolicyTest.create", () => {
  it("takes the file as new", () => {
    const test = PolicyTest.create(aFile("policies", PASSWORD_POLICY_TEST_FILE, aPolicyTest()));

    expect(test.status).toBe("created");
  });
});

describe("PolicyTest.fileName", () => {
  it("names the test file after its operation", () => {
    const name = PolicyTest.fileName(PASSWORD_POLICY);

    expect(name).toBe(PASSWORD_POLICY_TEST_FILE);
  });
});

describe("PolicyTest.resultOf", () => {
  it.each([
    ["passes an allowed password expected allowed", { allowed: true }, { allowed: true }, true],
    ["fails a refused password expected allowed", { allowed: true }, TOO_SHORT, false],
    ["passes a refusal expected with no code", { allowed: false }, TOO_SHORT, true],
    [
      "fails a refusal expected with another code",
      { allowed: false, code: "user.password_empty" },
      TOO_SHORT,
      false,
    ],
    [
      "passes a refusal expected with exactly its violations",
      { allowed: false, violations: ["min_length"] },
      TOO_SHORT,
      true,
    ],
    [
      "fails a refusal expected with fewer violations than it has",
      { allowed: false, violations: ["min_length"] },
      { ...TOO_SHORT, violations: { min_length: 12, max_length: 10 } },
      false,
    ],
    [
      "fails a refusal expected with other violations",
      { allowed: false, violations: ["max_length"] },
      TOO_SHORT,
      false,
    ],
  ])("%s", (_case, expected, actual, passes) => {
    const testCase = { ...TOO_SHORT_CASE, expect: expected };

    const result = PolicyTest.resultOf(testCase, actual);

    expect(result.passed).toBe(passes);
  });
});

describe("PolicyTest.operation", () => {
  it("reads the operation the cases test", () => {
    const test = PolicyTest.of(aFile("policies", PASSWORD_POLICY_TEST_FILE, aPolicyTest()));

    const operation = test.operation;

    expect(operation).toBe(PASSWORD_POLICY);
  });
});

describe("PolicyTest.cases", () => {
  it("reads the cases in the file's order", () => {
    const test = PolicyTest.of(
      aFile("policies", PASSWORD_POLICY_TEST_FILE, aPolicyTest([TOO_SHORT_CASE, LONG_ENOUGH_CASE])),
    );

    const cases = test.cases;

    expect(cases).toEqual([TOO_SHORT_CASE, LONG_ENOUGH_CASE]);
  });
});

describe("PolicyTest.check", () => {
  it("finds nothing wrong with a test file named after its operation", () => {
    const test = PolicyTest.of(aFile("policies", PASSWORD_POLICY_TEST_FILE, aPolicyTest()));

    const problems = test.check({});

    expect(problems).toEqual([]);
  });

  it("names the file a test file must have when it has another", () => {
    const test = PolicyTest.of(aFile("policies", "password.test.json", aPolicyTest()));

    const problems = test.check({});

    expect(problems).toMatchObject([
      {
        message: `tests the ${PASSWORD_POLICY} policy, so it must be named ${PASSWORD_POLICY_TEST_FILE}`,
      },
    ]);
  });
});

describe("PolicyTest.toWireBody", () => {
  it("gives the cases without the $schema pointer", () => {
    const test = PolicyTest.of(
      aFile("policies", PASSWORD_POLICY_TEST_FILE, {
        $schema: "../meta/policy-test.json",
        ...aPolicyTest(),
      }),
    );

    const body = test.toWireBody(new MemoryStore());

    expect(body).toEqual(aPolicyTest());
  });
});
