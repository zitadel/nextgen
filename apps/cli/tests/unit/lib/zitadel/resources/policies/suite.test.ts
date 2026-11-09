import { describe, expect, it } from "vitest";

import { BrokenFilesError, CONFIG_DIRECTORIES, MemoryStore, PolicyTest } from "@/lib/zitadel";
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

describe("PolicyTest.of", () => {
  it("takes the file as read", () => {
    const test = PolicyTest.of(aFile("policies", PASSWORD_POLICY_TEST_FILE, aPolicyTest()));

    expect(test.status).toBe("read");
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

describe("PolicyTest.readOperation", () => {
  it("reads the operation the cases test", () => {
    const test = PolicyTest.of(aFile("policies", PASSWORD_POLICY_TEST_FILE, aPolicyTest()));

    const operation = test.readOperation();

    expect(operation).toBe(PASSWORD_POLICY);
  });

  it("refuses a body the policy test contract refuses", () => {
    const test = PolicyTest.of(
      aFile("policies", PASSWORD_POLICY_TEST_FILE, { operation: PASSWORD_POLICY }),
    );

    const error = thrownBy(() => {
      return test.readOperation();
    });

    expect(error).toBeInstanceOf(BrokenFilesError);
    expect(error).toMatchObject({ problems: [{ path: PATH }] });
  });
});

describe("PolicyTest.readCases", () => {
  it("reads the cases in the file's order", () => {
    const test = PolicyTest.of(
      aFile("policies", PASSWORD_POLICY_TEST_FILE, aPolicyTest([TOO_SHORT_CASE, LONG_ENOUGH_CASE])),
    );

    const cases = test.readCases();

    expect(cases).toEqual([TOO_SHORT_CASE, LONG_ENOUGH_CASE]);
  });

  it("names the file and what the contract refuses in it", () => {
    const test = PolicyTest.of(
      aFile(
        "policies",
        PASSWORD_POLICY_TEST_FILE,
        aPolicyTest([{ ...TOO_SHORT_CASE, input: { passwd: "x" } }]),
      ),
    );

    const error = thrownBy(() => {
      return test.readCases();
    });

    expect(error).toBeInstanceOf(BrokenFilesError);
    expect(error).toMatchObject({ message: expect.stringContaining(`${PATH}: cases.0.input`) });
  });
});

describe("PolicyTest.markRead", () => {
  it("marks a new test file as read", () => {
    const test = PolicyTest.create(aFile("policies", PASSWORD_POLICY_TEST_FILE, aPolicyTest()));

    const read = test.markRead();

    expect(read.status).toBe("read");
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

  it("reports what the test contract refuses, under contract/policy", () => {
    const test = PolicyTest.of(
      aFile("policies", PASSWORD_POLICY_TEST_FILE, { operation: PASSWORD_POLICY }),
    );

    const problems = test.check({});

    expect(problems).toMatchObject([{ rule: "contract/policy" }]);
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
