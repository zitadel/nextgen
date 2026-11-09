import { describe, expect, it } from "vitest";

import { BrokenFilesError, PolicyTest } from "@/lib/zitadel";
import { MemoryStore } from "@/lib/zitadel/storage";
import type { JsonObject } from "@/lib/zitadel/types";

/**
 * The operation every test file in these tests is for.
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
 * A policy test file read from `.zitadel/policies/`.
 *
 * @param name - The file's name.
 * @param body - What it holds.
 * @returns The test file, as read.
 */
function testAt(name: string, body: JsonObject): PolicyTest {
  return PolicyTest.of({ path: `.zitadel/policies/${name}`, body });
}

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

describe("PolicyTest.fileName", () => {
  it("names the test file after its operation", () => {
    expect(PolicyTest.fileName(OPERATION)).toBe(`${OPERATION}.test.json`);
  });
});

describe("PolicyTest.readOperation", () => {
  it("reads the operation the cases test", () => {
    expect(testAt(`${OPERATION}.test.json`, TEST_FILE).readOperation()).toBe(OPERATION);
  });

  it("refuses a body the policy test contract refuses", () => {
    const test = testAt(`${OPERATION}.test.json`, { operation: OPERATION });

    expect(() => {
      return test.readOperation();
    }).toThrow(BrokenFilesError);
  });
});

describe("PolicyTest.readCases", () => {
  it("reads the cases in the file's order", () => {
    const second = { ...CASE, name: "long enough", expect: { allowed: true } };
    const test = testAt(`${OPERATION}.test.json`, { ...TEST_FILE, cases: [CASE, second] });

    expect(test.readCases()).toEqual([CASE, second]);
  });

  it("names the file and what the contract refuses in it", () => {
    const test = testAt(`${OPERATION}.test.json`, {
      ...TEST_FILE,
      cases: [{ ...CASE, input: { passwd: "x" } }],
    });

    expect(() => {
      return test.readCases();
    }).toThrow(/\.zitadel\/policies\/auth\.factor\.password\.set\.test\.json: cases\.0\.input/);
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
