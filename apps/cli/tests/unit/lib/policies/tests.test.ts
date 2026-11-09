import { PolicyService, type ZitadelClient } from "@/lib/backend";

import { describe, expect, it } from "vitest";

import { caseHolds, renderPolicyTestResults, runPolicyTests } from "@/lib/policies/tests";
import { PolicyTest } from "@/lib/zitadel";

/**
 * The operation every test file in these tests is for.
 */
const OPERATION = "auth.factor.password.set" as const;

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

describe("runPolicyTests", () => {
  it("keeps file and case order when the answers arrive out of order", async () => {
    const passwords = ["a", "bb", "ccc", "dddd", "eeeee"];
    // The shorter the password, the later its answer.
    const client = {
      evaluatePolicy: async (body: { input: { password: string } }) => {
        await new Promise((resolve) => setTimeout(resolve, 10 * (6 - body.input.password.length)));
        return { allowed: body.input.password.length > 2 };
      },
    } as unknown as ZitadelClient;
    const results = await runPolicyTests(
      new PolicyService(client, "proj_1"),
      [
        testFile("one.test.json", passwords.slice(0, 3)),
        testFile("two.test.json", passwords.slice(3)),
      ],
      new Map(),
    );

    expect(results.map((result) => result.file)).toEqual(["one.test.json", "two.test.json"]);
    expect(results.map((result) => result.cases.map((testCase) => testCase.name))).toEqual([
      ["a", "bb", "ccc"],
      ["dddd", "eeeee"],
    ]);
    expect(results[0]?.cases.map((testCase) => testCase.passed)).toEqual([false, false, true]);
  });

  it("evaluates each case against its operation's policy and names where it came from", async () => {
    const configs: unknown[] = [];
    const client = {
      evaluatePolicy: async (body: { config: unknown }) => {
        configs.push(body.config);
        return { allowed: true };
      },
    } as unknown as ZitadelClient;
    const source = { file: `.zitadel/policies/${OPERATION}.json` };

    const results = await runPolicyTests(
      new PolicyService(client, "proj_1"),
      [testFile("one.test.json", ["long enough"])],
      new Map([[OPERATION, { config: { min_length: 12 }, source }]]),
    );

    expect([configs, results[0]?.policy]).toEqual([[{ min_length: 12 }], source]);
  });
});

/**
 * A test file of {@link OPERATION} whose every case is a password expected to
 * be allowed.
 *
 * @param file - The test file's path.
 * @param passwords - One case per password, named after it.
 * @returns The test file, as read.
 */
function testFile(file: string, passwords: readonly string[]): PolicyTest {
  return PolicyTest.of({
    path: file,
    body: {
      operation: OPERATION,
      cases: passwords.map((password) => {
        return { name: password, input: { password }, expect: { allowed: true } };
      }),
    },
  });
}
