/**
 * Policy tests (#1445): `.zitadel/policies/<operation>.test.json` files hold
 * cases `zitadel policies test` evaluates on the server
 * (`POST /policies/evaluate`). The CLI never evaluates a policy itself; it
 * picks the config to evaluate, sends each case and compares the decision.
 *
 * The config comes from the sibling policy file, or with `--release` from the
 * revision a release pins. Neither present means no policy: the cases are
 * evaluated with `{}`, which is what the server enforces then (only its own
 * guards), so a case that expects a refusal shows what would get through.
 *
 * **Dependency rule.** No upward imports (`commands/`, `release/`).
 */
import { basename } from "node:path";

import { policyTestFileSchema } from "@zitadel/config/schemas";
import type { z } from "zod";

import type {
  PolicyDecision,
  PolicyEvaluation,
  PolicyService,
  ReleaseService,
} from "@/lib/backend";
import type { ZitadelConfig } from "@/lib/zitadel";
import { mapBounded } from "@/lib/map-bounded";
import { POLICY_TEST_SUFFIX, policyFileName } from "./index";
import { CONFIG_DIRECTORIES } from "@/lib/zitadel";

/**
 * A policy test file as `policyTestFileSchema` accepts it.
 */
export type PolicyTestFile = z.infer<typeof policyTestFileSchema>;

/**
 * One case's expected decision.
 */
export type PolicyTestExpect = PolicyTestFile["cases"][number]["expect"];

/**
 * A test file read from `.zitadel/policies/`, with its file name.
 */
export type PolicyTestSuite = {
  /**
   * The project-relative path of the test file.
   */
  file: string;
  /**
   * The cases it holds, as the test contract parsed them.
   */
  test: PolicyTestFile;
};

/**
 * The name a test file must have: its operation, beside the operation's policy file.
 *
 * @param operation - The operation.
 * @returns The file name.
 */
export function policyTestFileName(operation: string): string {
  return `${operation}${POLICY_TEST_SUFFIX}`;
}

/**
 * The test files in `.zitadel/policies/`, checked, and the problems found.
 *
 * @remarks
 * `operations` narrows them to those operations' files, by name and before
 * anything is parsed, so a broken test file of another operation never
 * blocks the ones asked for. One without a test file is a problem, so a typo
 * in the filter never passes silently.
 *
 * @param config - The configuration whose test files are read.
 * @param operations - The operations to read the test files of; every one when empty.
 * @returns The suites that are sound, and a line per problem found.
 */
export function readPolicyTests(
  config: ZitadelConfig,
  operations: readonly string[] = [],
): { suites: PolicyTestSuite[]; issues: string[] } {
  const wanted = new Set(operations.map(policyTestFileName));
  const entries = config.policies.tests
    .map((document) => {
      return {
        name: basename(document.path),
        body: document.body,
        problems: document.problems({}).map((issue) => {
          return issue.message;
        }),
      };
    })
    .filter((entry) => {
      return wanted.size === 0 || wanted.has(entry.name);
    });
  const suites: PolicyTestSuite[] = [];
  const issues: string[] = [];
  for (const entry of entries) {
    const file = `${CONFIG_DIRECTORIES.policies}/${entry.name}`;
    if (entry.problems.length > 0) {
      issues.push(
        ...entry.problems.map((problem) => {
          return `${file}: ${problem}`;
        }),
      );
      continue;
    }
    suites.push({ file, test: policyTestFileSchema.parse(entry.body) });
  }
  for (const operation of operations) {
    const file = policyTestFileName(operation);
    if (!entries.some((entry) => entry.name === file)) {
      issues.push(`${CONFIG_DIRECTORIES.policies}/${file} does not exist`);
    }
  }
  return { suites, issues };
}

/**
 * Where a tested config came from: a policy file, a release's revision, or nowhere.
 */
export type PolicySource = { file: string } | { revision_id: string } | null;

/**
 * The policy a suite is evaluated against, by operation.
 */
export type PolicyUnderTest = { config: PolicyEvaluation["config"]; source: PolicySource };

/**
 * The policies in `.zitadel/policies/`, by operation, and the problems found.
 *
 * @remarks
 * A policy file that fails its own check is a problem rather than "no
 * policy": testing `{}` in its place would report on a policy nobody wrote.
 * `operations` narrows them to those operations' files, by name and before
 * anything is parsed, as {@link readPolicyTests} does.
 *
 * @param config - The configuration whose policies are read.
 * @param operations - The operations to read the policies of; every one when empty.
 * @returns The sound policies by operation, and a line per problem found.
 */
export function policiesFromFiles(
  config: ZitadelConfig,
  operations: readonly string[] = [],
): { policies: Map<string, PolicyUnderTest>; issues: string[] } {
  const wanted = new Set(operations.map(policyFileName));
  const entries = config.policies.all
    .map((document) => {
      return {
        name: basename(document.path),
        body: document.body,
        problems: document.problems({}).map((issue) => {
          return issue.message;
        }),
      };
    })
    .filter((entry) => {
      return wanted.size === 0 || wanted.has(entry.name);
    });
  const policies = new Map<string, PolicyUnderTest>();
  const issues: string[] = [];
  for (const entry of entries) {
    const file = `${CONFIG_DIRECTORIES.policies}/${entry.name}`;
    if (entry.problems.length > 0) {
      issues.push(
        ...entry.problems.map((problem) => {
          return `${file}: ${problem}`;
        }),
      );
      continue;
    }
    // Checked against the policy file schema just above.
    const { operation, config } = entry.body as {
      operation: string;
      config: PolicyEvaluation["config"];
    };
    policies.set(operation, { config, source: { file } });
  }
  return { policies, issues };
}

/**
 * A release's policies, and whether anything can still serve them.
 */
export type ReleasePolicies = {
  /**
   * The policies the release pins, by operation.
   */
  policies: Map<string, PolicyUnderTest>;
  /**
   * Whether the release is revoked, so its policies serve no origin.
   */
  revoked: boolean;
};

/**
 * The policies a release pins, by operation, read as the revisions it pins.
 *
 * @remarks
 * Whether it is revoked comes along: that does not stop the test, but its
 * policies then serve no origin.
 *
 * @param releases - Where the release is read from.
 * @param service - Where each pinned revision is read from.
 * @param releaseId - The release.
 * @returns The release's policies, and whether it is revoked.
 */
export async function policiesFromRelease(
  releases: ReleaseService,
  service: PolicyService,
  releaseId: string,
): Promise<ReleasePolicies> {
  const release = await releases.get(releaseId);
  const pinned = release.pointers.filter((pointer) => pointer.kind === "policy");
  const revisions = await Promise.all(
    pinned.map(async (pointer): Promise<[string, PolicyUnderTest]> => {
      const revision = await service.revision(pointer.revision_id);
      return [
        pointer.handle,
        { config: revision.config, source: { revision_id: pointer.revision_id } },
      ];
    }),
  );
  const policies = new Map(revisions);
  return {
    policies,
    revoked: release.revoked_at !== null,
  };
}

/**
 * One case's outcome: what it expected and what the server decided.
 */
export type PolicyCaseResult = {
  /**
   * The case's name.
   */
  name: string;
  /**
   * Whether the decision is what the case expects.
   */
  passed: boolean;
  /**
   * The decision the case expects.
   */
  expected: PolicyTestExpect;
  /**
   * The decision the server made.
   */
  actual: PolicyDecision;
};

/**
 * One test file's outcome.
 */
export type PolicySuiteResult = {
  /**
   * The operation the file tests.
   */
  operation: string;
  /**
   * The project-relative path of the test file.
   */
  file: string;
  /**
   * Where the policy the cases ran against came from.
   */
  policy: PolicySource;
  /**
   * Each case's outcome, in the file's order.
   */
  cases: PolicyCaseResult[];
};

/**
 * Whether a decision is what a case expects.
 *
 * @remarks
 * `allowed` always, `code` when given, and `violations` when given as exactly
 * that set of rule names, so a rule that fails unexpectedly fails the case too.
 *
 * @param expected - The decision the case expects.
 * @param actual - The decision the server made.
 * @returns Whether they agree.
 */
export function caseHolds(expected: PolicyTestExpect, actual: PolicyDecision): boolean {
  if (expected.allowed !== actual.allowed) {
    return false;
  }
  if (expected.code !== undefined && expected.code !== actual.code) {
    return false;
  }
  if (expected.violations !== undefined) {
    const got = Object.keys(actual.violations ?? {}).sort();
    const want = [...new Set(expected.violations)].sort();
    return got.length === want.length && got.every((name, index) => name === want[index]);
  }
  return true;
}

/**
 * How many evaluate requests a run keeps in flight at once.
 */
const EVALUATE_CONCURRENCY = 8;

/**
 * Evaluates every case of every suite against its operation's policy, or `{}`
 * when there is none.
 *
 * @remarks
 * One request per case, a few in flight at once.
 *
 * @param service - Where each case is evaluated.
 * @param suites - The test files.
 * @param policies - The policy each operation is evaluated against.
 * @returns Each suite's outcome, in file and case order.
 */
export async function runPolicyTests(
  service: PolicyService,
  suites: readonly PolicyTestSuite[],
  policies: ReadonlyMap<string, PolicyUnderTest>,
): Promise<PolicySuiteResult[]> {
  const runs = suites.flatMap(({ test }, suite) =>
    test.cases.map((testCase) => ({ suite, operation: test.operation, testCase })),
  );
  const outcomes = await mapBounded(
    runs,
    EVALUATE_CONCURRENCY,
    async ({ suite, operation, testCase }) => {
      const actual = await service.evaluate({
        operation,
        config: policies.get(operation)?.config ?? {},
        input: testCase.input,
        ...(testCase.facts === undefined ? {} : { facts: testCase.facts }),
      });
      const result: PolicyCaseResult = {
        name: testCase.name,
        passed: caseHolds(testCase.expect, actual),
        expected: testCase.expect,
        actual,
      };
      return { suite, result };
    },
  );
  return suites.map(({ file, test }, suite) => ({
    operation: test.operation,
    file,
    policy: policies.get(test.operation)?.source ?? null,
    cases: outcomes.filter((outcome) => outcome.suite === suite).map(({ result }) => result),
  }));
}

/**
 * A decision in words.
 *
 * @param decision - The decision, expected or made.
 * @returns `allowed`, or refused with its code and its rules, each when known,
 *   so a mismatch in either shows on the line.
 */
function describeDecision(decision: {
  allowed: boolean;
  code?: string;
  violations?: readonly string[];
}): string {
  if (decision.allowed) {
    return "allowed";
  }
  const rules = decision.violations?.length ? decision.violations.join(", ") : undefined;
  const reason = [decision.code, rules].filter((part) => part !== undefined).join(": ");
  return reason === "" ? "refused" : `refused (${reason})`;
}

/**
 * Where a suite's policy came from, as its heading names it.
 *
 * @param policy - Where the policy came from.
 * @param release - The release the run was told to test against, if any.
 * @returns The words for the heading.
 */
function describePolicy(policy: PolicySource, release: string | undefined): string {
  if (policy === null) {
    return release === undefined
      ? "no policy file, nothing enforced"
      : `release ${release} pins no policy, nothing enforced`;
  }
  if ("file" in policy) {
    return policy.file;
  }
  return `release ${release}, revision ${policy.revision_id}`;
}

/**
 * The results for a terminal.
 *
 * @param results - Each suite's outcome.
 * @param release - The release the run was told to test against, if any.
 * @returns Each test file under a heading naming the policy it ran against, a
 *   line per case, and on a failed case what was expected and what the server
 *   decided; then the totals.
 */
export function renderPolicyTestResults(
  results: readonly PolicySuiteResult[],
  release?: string,
): string {
  const lines = results.flatMap((result) => [
    `${result.operation}  (${describePolicy(result.policy, release)})`,
    ...result.cases.map((testCase) => {
      if (testCase.passed) {
        return `  ✓ ${testCase.name}`;
      }
      const actual = describeDecision({
        allowed: testCase.actual.allowed,
        code: testCase.actual.code,
        violations: Object.keys(testCase.actual.violations ?? {}),
      });
      return `  ✗ ${testCase.name}: expected ${describeDecision(testCase.expected)}, got ${actual}`;
    }),
  ]);
  const cases = results.flatMap((result) => result.cases);
  const passed = cases.filter((testCase) => testCase.passed).length;
  const failed = cases.length - passed;
  lines.push("", failed === 0 ? `${passed} passed` : `${passed} passed, ${failed} failed`);
  return lines.join("\n");
}
