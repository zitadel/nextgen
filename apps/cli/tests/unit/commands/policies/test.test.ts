import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { Config } from "@oclif/core";
import { describe, expect, it, vi } from "vitest";

import PoliciesTest, {
  type PolicySuiteResult,
  type PolicyUnderTest,
} from "@/commands/policies/test";
import { PolicyService } from "@/lib/backend";
import { PolicyTest, SignupPolicy } from "@/lib/zitadel";
import { PASSWORD_POLICY } from "@tests/helpers/config";
import { fakeClient } from "@tests/helpers/fake-client";
import { it as withDir } from "@tests/helpers/fixtures";
import { cliPackageRoot } from "@tests/helpers/oclif-build";
import { PROJECT_ID } from "@tests/helpers/records";

/**
 * The CLI's oclif configuration, which a command is built with.
 */
const CONFIG = await Config.load({ root: cliPackageRoot });

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
 * `policies test` with its runner and its rendering reachable, to drive them
 * without a run.
 */
class ReachablePoliciesTest extends PoliciesTest {
  /**
   * Evaluates every case of every test file against its operation's policy.
   *
   * @param service - Where each case is evaluated.
   * @param tests - The test files.
   * @param policies - The policy each operation is evaluated against.
   * @returns Each test file's outcome, in file and case order.
   * @throws {@link ZitadelError} When the server cannot evaluate a case.
   */
  runCases(
    service: PolicyService,
    tests: readonly PolicyTest[],
    policies: ReadonlyMap<string, PolicyUnderTest>,
  ): Promise<readonly PolicySuiteResult[]> {
    return this.runPolicyTests(service, tests, policies);
  }

  /**
   * Renders the results for a terminal.
   *
   * @param results - Each test file's outcome.
   * @param release - The release the run was told to test against, if any.
   * @returns The rendering.
   */
  render(results: readonly PolicySuiteResult[], release?: string): string {
    return this.renderPolicyTestResults(results, release);
  }
}

/**
 * The command, built without a run.
 *
 * @returns The command, its runner and rendering reachable.
 */
function aCommand(): ReachablePoliciesTest {
  return new ReachablePoliciesTest([], CONFIG);
}

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

/**
 * A policy service that allows a password longer than two characters, and
 * answers only once every case has asked, the shortest password last.
 *
 * @param cases - How many cases will ask.
 * @returns The service.
 */
function answeringBackwards(cases: number): PolicyService {
  const waiting: { readonly length: number; readonly answer: () => void }[] = [];
  return new PolicyService(
    fakeClient({
      evaluatePolicy: (evaluation) => {
        const input = evaluation.input;
        const length = "password" in input ? input.password.length : 0;
        return new Promise((resolve) => {
          waiting.push({
            length,
            answer: () => {
              resolve({ allowed: length > 2 });
            },
          });
          if (waiting.length === cases) {
            [...waiting]
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
}

/**
 * A policy service that allows every case.
 *
 * @returns The service.
 */
function allowingEverything(): PolicyService {
  return new PolicyService(
    fakeClient({
      evaluatePolicy: async () => {
        return { allowed: true };
      },
    }),
    PROJECT_ID,
  );
}

/**
 * Two test files of the password policy, five cases in all, of which the two
 * shortest passwords are no longer than two characters.
 */
const TWO_FILES = [
  aTestFile("one.test.json", ["a", "bb", "ccc"]),
  aTestFile("two.test.json", ["dddd", "eeeee"]),
];

/**
 * Where the password policy in these tests came from.
 */
const POLICY_FILE = { file: `.zitadel/policies/${PASSWORD_POLICY}.json` };

/**
 * The password policy, requiring twelve characters, by its operation.
 */
const POLICIES = new Map([[PASSWORD_POLICY, { config: { min_length: 12 }, source: POLICY_FILE }]]);

describe("PoliciesTest.runPolicyTests", () => {
  describe("when the answers arrive out of order", () => {
    it("keeps the files in order", async () => {
      const results = await aCommand().runCases(answeringBackwards(5), TWO_FILES, new Map());

      expect(
        results.map((result) => {
          return result.file;
        }),
      ).toEqual(["one.test.json", "two.test.json"]);
    });

    it("keeps each file's cases in order", async () => {
      const results = await aCommand().runCases(answeringBackwards(5), TWO_FILES, new Map());

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
      const results = await aCommand().runCases(answeringBackwards(5), TWO_FILES, new Map());

      expect(
        results[0]?.cases.map((testCase) => {
          return testCase.passed;
        }),
      ).toEqual([false, false, true]);
    });
  });

  describe("with a policy for the operation", () => {
    it("evaluates each case against the operation's policy", async () => {
      const evaluatePolicy = vi.fn(async () => {
        return { allowed: true };
      });
      const service = new PolicyService(fakeClient({ evaluatePolicy }), PROJECT_ID);

      await aCommand().runCases(service, [aTestFile("one.test.json", ["long enough"])], POLICIES);

      expect(evaluatePolicy).toHaveBeenCalledWith(
        expect.objectContaining({ config: { min_length: 12 } }),
        { project_id: PROJECT_ID },
      );
    });

    it("names where the policy came from", async () => {
      const results = await aCommand().runCases(
        allowingEverything(),
        [aTestFile("one.test.json", ["long enough"])],
        POLICIES,
      );

      expect(results[0]?.policy).toEqual(POLICY_FILE);
    });
  });

  describe("with a sign-up test file", () => {
    it("sends each case in the operation's own shape, with its policy and no facts", async () => {
      const evaluatePolicy = vi.fn(async () => {
        return { allowed: true };
      });
      const service = new PolicyService(fakeClient({ evaluatePolicy }), PROJECT_ID);
      const test = PolicyTest.of({
        path: PolicyTest.fileName(SignupPolicy.OPERATION),
        body: {
          operation: SignupPolicy.OPERATION,
          cases: [
            {
              name: "the built-in proof of work",
              input: { solved_challenge: "zitadel_pow" },
              expect: { allowed: true },
            },
          ],
        },
      });
      const policies = new Map<string, PolicyUnderTest>([
        [
          SignupPolicy.OPERATION,
          { config: { challenge: "zitadel_pow" }, source: { file: SignupPolicy.PATH } },
        ],
      ]);

      const results = await aCommand().runCases(service, [test], policies);

      expect(evaluatePolicy).toHaveBeenCalledWith(
        {
          operation: SignupPolicy.OPERATION,
          config: { challenge: "zitadel_pow" },
          input: { solved_challenge: "zitadel_pow" },
        },
        { project_id: PROJECT_ID },
      );
      expect(results[0]?.cases[0]?.passed).toBe(true);
    });
  });
});

describe("PoliciesTest.renderPolicyTestResults", () => {
  it("names the policy file and each case, and the totals", () => {
    const suite = {
      operation: PASSWORD_POLICY,
      file: `.zitadel/policies/${PASSWORD_POLICY}.test.json`,
      policy: POLICY_FILE,
      cases: [PASSED, FAILED],
    };

    const rendered = aCommand().render([suite]);

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

  describe("with no policy", () => {
    it.each([
      ["no release", undefined, "(no policy file, nothing enforced)"],
      ["a release", "rel_1", "(release rel_1 pins no policy, nothing enforced)"],
    ])("says nothing is enforced, against %s", (_against, release, said) => {
      const suite = { operation: PASSWORD_POLICY, file: "", policy: null, cases: [PASSED] };

      const rendered = aCommand().render([suite], release);

      expect(rendered).toContain(said);
    });
  });

  describe("with a release's policy", () => {
    it("names the release and the revision it pins", () => {
      const suite = {
        operation: PASSWORD_POLICY,
        file: "",
        policy: { revision_id: "polrev_1" },
        cases: [PASSED],
      };

      const rendered = aCommand().render([suite], "rel_1");

      expect(rendered).toContain("(release rel_1, revision polrev_1)");
    });
  });

  describe("when only the code differs", () => {
    it("shows both codes", () => {
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

      const rendered = aCommand().render([suite]);

      expect(rendered).toContain(
        "  ✗ wrong code: expected refused (user.password_empty: min_length), got refused (user.password_policy_violation: min_length)",
      );
    });
  });
});

describe("PoliciesTest.execute", () => {
  describe("when a file of a kind that holds no policy cannot be read", () => {
    withDir("still looks for the policy tests", async ({ dir }) => {
      await mkdir(join(dir, ".zitadel/schemas/unreadable.json"), { recursive: true });

      const envelope = await PoliciesTest.run(["--cwd", dir, "--json"]);

      expect(JSON.parse(JSON.stringify(envelope))).toMatchObject({ status: "skipped" });
    });
  });
});
