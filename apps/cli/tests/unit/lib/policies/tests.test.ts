import { describe, expect, it, vi } from "vitest";

import { PolicyService } from "@/lib/backend";
import { caseHolds, renderPolicyTestResults, runPolicyTests } from "@/lib/policies/tests";
import { PolicyTest } from "@/lib/zitadel";
import { PASSWORD_POLICY } from "@tests/helpers/config";
import { fakeClient } from "@tests/helpers/fake-client";
import { PROJECT_ID } from "@tests/helpers/records";

/**
 * A password the policy refused for being too short.
 */
const TOO_SHORT = {
  allowed: false,
  code: "user.password_policy_violation",
  violations: { min_length: 12 },
};

/**
 * A case that held.
 */
const PASSED = {
  name: "long enough",
  passed: true,
  expected: { allowed: true },
  actual: { allowed: true },
};

/**
 * A case that did not hold.
 */
const FAILED = {
  name: "too short",
  passed: false,
  expected: { allowed: false, violations: ["min_length"] },
  actual: { allowed: true },
};

/**
 * A test file of the password policy whose every case is a password expected
 * to be allowed, named after it.
 *
 * @param path - The test file's path.
 * @param passwords - One case per password.
 * @returns The test file, as read.
 */
function aTestFile(path: string, passwords: readonly string[]): PolicyTest {
  return PolicyTest.of({
    path,
    body: {
      operation: PASSWORD_POLICY,
      cases: passwords.map((password) => {
        return { name: password, input: { password }, expect: { allowed: true } };
      }),
    },
  });
}

describe("caseHolds", () => {
  it.each([
    ["holds for an allowed password expected allowed", { allowed: true }, { allowed: true }, true],
    ["fails for a refused password expected allowed", { allowed: true }, TOO_SHORT, false],
    ["holds for a refusal expected with no code", { allowed: false }, TOO_SHORT, true],
    [
      "fails for a refusal expected with another code",
      { allowed: false, code: "user.password_empty" },
      TOO_SHORT,
      false,
    ],
    [
      "holds for a refusal expected with exactly its violations",
      { allowed: false, violations: ["min_length"] },
      TOO_SHORT,
      true,
    ],
    [
      "fails for a refusal expected with fewer violations than it has",
      { allowed: false, violations: ["min_length"] },
      { ...TOO_SHORT, violations: { min_length: 12, max_length: 10 } },
      false,
    ],
    [
      "fails for a refusal expected with other violations",
      { allowed: false, violations: ["max_length"] },
      TOO_SHORT,
      false,
    ],
  ])("%s", (_case, expected, actual, holds) => {
    const held = caseHolds(expected, actual);

    expect(held).toBe(holds);
  });
});

describe("renderPolicyTestResults", () => {
  it("names the policy file and each case, and the totals", () => {
    const rendered = renderPolicyTestResults([
      {
        operation: PASSWORD_POLICY,
        file: `.zitadel/policies/${PASSWORD_POLICY}.test.json`,
        policy: { file: `.zitadel/policies/${PASSWORD_POLICY}.json` },
        cases: [PASSED, FAILED],
      },
    ]);

    expect(rendered).toBe(
      [
        `${PASSWORD_POLICY}  (.zitadel/policies/${PASSWORD_POLICY}.json)`,
        "  ✓ long enough",
        "  ✗ too short: expected refused (min_length), got allowed",
        "",
        "1 passed, 1 failed",
      ].join("\n"),
    );
  });

  it.each([
    ["no release", undefined, "(no policy file, nothing enforced)"],
    ["a release", "rel_1", "(release rel_1 pins no policy, nothing enforced)"],
  ])("says when nothing is enforced, against %s", (_against, release, said) => {
    const suite = { operation: PASSWORD_POLICY, file: "", policy: null, cases: [PASSED] };

    const rendered = renderPolicyTestResults([suite], release);

    expect(rendered).toContain(said);
  });

  it("names the release and the revision it pins", () => {
    const suite = {
      operation: PASSWORD_POLICY,
      file: "",
      policy: { revision_id: "polrev_1" },
      cases: [PASSED],
    };

    const rendered = renderPolicyTestResults([suite], "rel_1");

    expect(rendered).toContain("(release rel_1, revision polrev_1)");
  });

  it("shows the codes when only the code differs", () => {
    const suite = {
      operation: PASSWORD_POLICY,
      file: "",
      policy: null,
      cases: [
        {
          name: "wrong code",
          passed: false,
          expected: { allowed: false, code: "user.password_empty", violations: ["min_length"] },
          actual: TOO_SHORT,
        },
      ],
    };

    const rendered = renderPolicyTestResults([suite]);

    expect(rendered).toContain(
      "  ✗ wrong code: expected refused (user.password_empty: min_length), got refused (user.password_policy_violation: min_length)",
    );
  });
});

describe("runPolicyTests", () => {
  describe("when the answers arrive out of order", () => {
    /**
     * A policy service that allows a password longer than two characters, and
     * answers only once every case has asked, the shortest password last.
     *
     * @param cases - How many cases will ask.
     * @returns The service.
     */
    const answeringBackwards = (cases: number): PolicyService => {
      const waiting: { length: number; answer: () => void }[] = [];
      return new PolicyService(
        fakeClient({
          evaluatePolicy: (evaluation) => {
            const length = String(evaluation.input.password).length;
            return new Promise((resolve) => {
              waiting.push({
                length,
                answer: () => {
                  resolve({ allowed: length > 2 });
                },
              });
              if (waiting.length === cases) {
                waiting
                  .sort((a, b) => {
                    return b.length - a.length;
                  })
                  .forEach((ask) => {
                    ask.answer();
                  });
              }
            });
          },
        }),
        PROJECT_ID,
      );
    };
    const tests = [
      aTestFile("one.test.json", ["a", "bb", "ccc"]),
      aTestFile("two.test.json", ["dddd", "eeeee"]),
    ];

    it("keeps the files in order", async () => {
      const results = await runPolicyTests(answeringBackwards(5), tests, new Map());

      expect(
        results.map((result) => {
          return result.file;
        }),
      ).toEqual(["one.test.json", "two.test.json"]);
    });

    it("keeps each file's cases in order", async () => {
      const results = await runPolicyTests(answeringBackwards(5), tests, new Map());

      expect(
        results.map((result) => {
          return result.cases.map((testCase) => {
            return testCase.name;
          });
        }),
      ).toEqual([
        ["a", "bb", "ccc"],
        ["dddd", "eeeee"],
      ]);
    });

    it("gives each case its own answer", async () => {
      const results = await runPolicyTests(answeringBackwards(5), tests, new Map());

      expect(
        results[0]?.cases.map((testCase) => {
          return testCase.passed;
        }),
      ).toEqual([false, false, true]);
    });
  });

  describe("with a policy for the operation", () => {
    const source = { file: `.zitadel/policies/${PASSWORD_POLICY}.json` };
    const policies = new Map([[PASSWORD_POLICY, { config: { min_length: 12 }, source }]]);

    it("evaluates each case against the operation's policy", async () => {
      const evaluatePolicy = vi.fn(async () => {
        return { allowed: true };
      });
      const service = new PolicyService(fakeClient({ evaluatePolicy }), PROJECT_ID);

      await runPolicyTests(service, [aTestFile("one.test.json", ["long enough"])], policies);

      expect(evaluatePolicy).toHaveBeenCalledWith(
        expect.objectContaining({ config: { min_length: 12 } }),
        { project_id: PROJECT_ID },
      );
    });

    it("names where the policy came from", async () => {
      const service = new PolicyService(
        fakeClient({
          evaluatePolicy: async () => {
            return { allowed: true };
          },
        }),
        PROJECT_ID,
      );

      const results = await runPolicyTests(
        service,
        [aTestFile("one.test.json", ["long enough"])],
        policies,
      );

      expect(results[0]?.policy).toEqual(source);
    });
  });
});
