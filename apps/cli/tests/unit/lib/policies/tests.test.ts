import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  caseHolds,
  policiesFromFiles,
  policyTestFileIssues,
  readPolicyTests,
  renderPolicyTestResults,
} from "../../../../src/lib/policies/tests";

const OPERATION = "auth.factor.password.set";
const CASE = {
  name: "too short",
  input: { password: "short1" },
  expect: { allowed: false, violations: ["min_length"] },
};
const TEST_FILE = { operation: OPERATION, cases: [CASE] };

let dir: string | undefined;

async function project(files: Record<string, unknown>): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "zitadel-policy-tests-"));
  await mkdir(join(dir, ".zitadel/policies"), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, ".zitadel/policies", name), JSON.stringify(content));
  }
  return dir;
}

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

describe("policyTestFileIssues", () => {
  it("accepts a test file named after its operation", () => {
    expect(policyTestFileIssues(TEST_FILE, `.zitadel/policies/${OPERATION}.test.json`)).toEqual([]);
  });

  it("names a file not named after its operation", () => {
    expect(policyTestFileIssues(TEST_FILE, ".zitadel/policies/password.test.json")).toEqual([
      `.zitadel/policies/password.test.json tests the ${OPERATION} policy, so it must be named ${OPERATION}.test.json`,
    ]);
  });

  it("names the path of what the schema refuses", () => {
    const issues = policyTestFileIssues(
      { ...TEST_FILE, cases: [{ ...CASE, input: { passwd: "x" } }] },
      `.zitadel/policies/${OPERATION}.test.json`,
    );
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue).toMatch(
        /^\.zitadel\/policies\/auth\.factor\.password\.set\.test\.json: cases\.0\.input/,
      );
    }
  });
});

describe("readPolicyTests", () => {
  it("reads only the test files", async () => {
    const cwd = await project({
      [`${OPERATION}.json`]: { operation: OPERATION, config: {} },
      [`${OPERATION}.test.json`]: TEST_FILE,
    });

    const { suites, issues } = await readPolicyTests(cwd);

    expect(issues).toEqual([]);
    expect(suites).toEqual([{ file: `.zitadel/policies/${OPERATION}.test.json`, test: TEST_FILE }]);
  });

  it("names an operation asked for that has no test file", async () => {
    const cwd = await project({ [`${OPERATION}.test.json`]: TEST_FILE });

    const { suites, issues } = await readPolicyTests(cwd, ["auth.unknown"]);

    expect(suites).toEqual([]);
    expect(issues).toEqual([".zitadel/policies/auth.unknown.test.json does not exist"]);
  });

  it("never reads another operation's test file when one is asked for", async () => {
    const cwd = await project({
      [`${OPERATION}.test.json`]: TEST_FILE,
      "scratch.test.json": { cases: "not a test" },
    });

    const { suites, issues } = await readPolicyTests(cwd, [OPERATION]);

    expect(issues).toEqual([]);
    expect(suites.map((suite) => suite.test.operation)).toEqual([OPERATION]);
  });
});

describe("policiesFromFiles", () => {
  it("maps each policy file to its operation, without the test files", async () => {
    const cwd = await project({
      [`${OPERATION}.json`]: { operation: OPERATION, config: { min_length: 12 } },
      [`${OPERATION}.test.json`]: TEST_FILE,
    });

    const { policies, issues } = await policiesFromFiles(cwd);

    expect(issues).toEqual([]);
    expect(policies.get(OPERATION)).toEqual({
      config: { min_length: 12 },
      source: { file: `.zitadel/policies/${OPERATION}.json` },
    });
  });

  it("reports an invalid policy file rather than testing no policy", async () => {
    const cwd = await project({
      [`${OPERATION}.json`]: { operation: OPERATION, config: { min_length: 0 } },
    });

    const { policies, issues } = await policiesFromFiles(cwd);

    expect(policies.size).toBe(0);
    expect(issues).toHaveLength(1);
  });
});

describe("caseHolds", () => {
  const refused = {
    allowed: false,
    code: "user.password_policy_violation",
    violations: { min_length: 12 },
  };

  it("compares allowed", () => {
    expect(caseHolds({ allowed: true }, { allowed: true })).toBe(true);
    expect(caseHolds({ allowed: true }, refused)).toBe(false);
  });

  it("compares the code only when given", () => {
    expect(caseHolds({ allowed: false }, refused)).toBe(true);
    expect(caseHolds({ allowed: false, code: "user.password_empty" }, refused)).toBe(false);
  });

  it("compares the violations as an exact set", () => {
    expect(caseHolds({ allowed: false, violations: ["min_length"] }, refused)).toBe(true);
    expect(
      caseHolds(
        { allowed: false, violations: ["min_length"] },
        { ...refused, violations: { min_length: 12, max_length: 10 } },
      ),
    ).toBe(false);
    expect(caseHolds({ allowed: false, violations: ["max_length"] }, refused)).toBe(false);
  });
});

describe("renderPolicyTestResults", () => {
  const passed = {
    name: "long enough",
    passed: true,
    expected: { allowed: true },
    actual: { allowed: true },
  };
  const failed = {
    name: "too short",
    passed: false,
    expected: { allowed: false, violations: ["min_length"] },
    actual: { allowed: true },
  };

  it("names the policy file and each case, and the totals", () => {
    expect(
      renderPolicyTestResults([
        {
          operation: OPERATION,
          file: `.zitadel/policies/${OPERATION}.test.json`,
          policy: { file: `.zitadel/policies/${OPERATION}.json` },
          cases: [passed, failed],
        },
      ]),
    ).toBe(
      [
        `${OPERATION}  (.zitadel/policies/${OPERATION}.json)`,
        "  ✓ long enough",
        "  ✗ too short: expected refused (min_length), got allowed",
        "",
        "1 passed, 1 failed",
      ].join("\n"),
    );
  });

  it("says when nothing is enforced", () => {
    const suite = { operation: OPERATION, file: "", policy: null, cases: [passed] };
    expect(renderPolicyTestResults([suite])).toContain("(no policy file, nothing enforced)");
    expect(renderPolicyTestResults([suite], "rel_1")).toContain(
      "(release rel_1 pins no policy, nothing enforced)",
    );
  });

  it("names the release and the revision it pins", () => {
    const suite = {
      operation: OPERATION,
      file: "",
      policy: { revision_id: "polrev_1" },
      cases: [passed],
    };
    expect(renderPolicyTestResults([suite], "rel_1")).toContain(
      "(release rel_1, revision polrev_1)",
    );
  });

  it("shows the codes when only the code differs", () => {
    const suite = {
      operation: OPERATION,
      file: "",
      policy: null,
      cases: [
        {
          name: "wrong code",
          passed: false,
          expected: { allowed: false, code: "user.password_empty", violations: ["min_length"] },
          actual: {
            allowed: false,
            code: "user.password_policy_violation",
            violations: { min_length: 12 },
          },
        },
      ],
    };
    expect(renderPolicyTestResults([suite])).toContain(
      "  ✗ wrong code: expected refused (user.password_empty: min_length), got refused (user.password_policy_violation: min_length)",
    );
  });
});
