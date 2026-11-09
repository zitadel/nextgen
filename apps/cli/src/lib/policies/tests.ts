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
 * Reading the test and policy files is the configuration library's
 * (`config.policies.testsFor`, `config.policies.for`); this module runs them.
 *
 * **Dependency rule.** No upward imports (`commands/`, `release/`).
 */
import type {
  PolicyDecision,
  PolicyEvaluation,
  PolicyService,
  ReleaseService,
} from "@/lib/backend";
import { mapBounded } from "@/lib/map-bounded";
import type { PolicyCase, PolicyExpectation, PolicyOperation, PolicyTest } from "@/lib/zitadel";

/**
 * Where a tested config came from: a policy file, a release's revision, or
 * nowhere.
 *
 * @remarks
 * The shape is the `--json` output's, so each source is told apart by the key
 * it carries rather than by a `kind`.
 */
export type PolicySource =
  | { readonly file: string }
  | { readonly revision_id: string }
  | null;

/**
 * The policy a test file is evaluated against, by operation.
 */
export type PolicyUnderTest = {
  /**
   * The rules evaluated.
   */
  readonly config: PolicyEvaluation["config"];

  /**
   * Where the rules came from.
   */
  readonly source: PolicySource;
};

/**
 * A release's policies, and whether anything can still serve them.
 */
export type ReleasePolicies = {
  /**
   * The policies the release pins, by operation.
   */
  readonly policies: ReadonlyMap<string, PolicyUnderTest>;

  /**
   * Whether the release is revoked, so its policies serve no origin.
   */
  readonly revoked: boolean;
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
  const pinned = release.pointers.filter((pointer) => {
    return pointer.kind === "policy";
  });
  const revisions = await Promise.all(
    pinned.map(async (pointer): Promise<readonly [string, PolicyUnderTest]> => {
      const revision = await service.revision(pointer.revision_id);
      const policy: PolicyUnderTest = {
        config: revision.config,
        source: { revision_id: pointer.revision_id },
      };
      return [pointer.handle, policy];
    }),
  );
  return {
    policies: new Map(revisions),
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
  readonly name: string;

  /**
   * Whether the decision is what the case expects.
   */
  readonly passed: boolean;

  /**
   * The decision the case expects.
   */
  readonly expected: PolicyExpectation;

  /**
   * The decision the server made.
   */
  readonly actual: PolicyDecision;
};

/**
 * One test file's outcome.
 */
export type PolicySuiteResult = {
  /**
   * The operation the file tests.
   */
  readonly operation: PolicyOperation;

  /**
   * The project-relative path of the test file.
   */
  readonly file: string;

  /**
   * Where the policy the cases ran against came from.
   */
  readonly policy: PolicySource;

  /**
   * Each case's outcome, in the file's order.
   */
  readonly cases: readonly PolicyCaseResult[];
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
export function caseHolds(expected: PolicyExpectation, actual: PolicyDecision): boolean {
  if (expected.allowed !== actual.allowed) {
    return false;
  }
  if (expected.code !== undefined && expected.code !== actual.code) {
    return false;
  }
  if (expected.violations === undefined) {
    return true;
  }
  // Both are fresh arrays, so sorting them changes nothing anyone else holds.
  const got = Object.keys(actual.violations ?? {}).sort();
  const want = [...new Set(expected.violations)].sort();
  if (got.length !== want.length) {
    return false;
  }
  return got.every((name, index) => {
    return name === want[index];
  });
}

/**
 * How many evaluate requests a run keeps in flight at once.
 */
const EVALUATE_CONCURRENCY = 8;

/**
 * One case to evaluate, and the test file it belongs to.
 */
type CaseRun = {
  /**
   * The test file's position among the files.
   */
  readonly suite: number;

  /**
   * The operation the file tests.
   */
  readonly operation: PolicyOperation;

  /**
   * The case.
   */
  readonly testCase: PolicyCase;
};

/**
 * One case's outcome, and the test file it belongs to.
 */
type CaseOutcome = {
  /**
   * The test file's position among the files.
   */
  readonly suite: number;

  /**
   * The outcome.
   */
  readonly result: PolicyCaseResult;
};

/**
 * Evaluate every case of every test file against its operation's policy, or
 * `{}` when there is none.
 *
 * @remarks
 * One request per case, a few in flight at once.
 *
 * @param service - Where each case is evaluated.
 * @param tests - The test files, each sound.
 * @param policies - The policy each operation is evaluated against.
 * @returns Each test file's outcome, in file and case order.
 */
export async function runPolicyTests(
  service: PolicyService,
  tests: readonly PolicyTest[],
  policies: ReadonlyMap<string, PolicyUnderTest>,
): Promise<readonly PolicySuiteResult[]> {
  const runs = tests.flatMap((test, suite) => {
    return test.cases.map((testCase): CaseRun => {
      return { suite, operation: test.operation, testCase };
    });
  });
  const outcomes = await mapBounded(
    runs,
    EVALUATE_CONCURRENCY,
    async (run): Promise<CaseOutcome> => {
      const testCase = run.testCase;
      const config = policies.get(run.operation)?.config ?? {};
      // A case without facts sends none: the key is dropped on the wire.
      const actual = await service.evaluate({
        operation: run.operation,
        config,
        input: testCase.input,
        facts: testCase.facts,
      });
      const result: PolicyCaseResult = {
        name: testCase.name,
        passed: caseHolds(testCase.expect, actual),
        expected: testCase.expect,
        actual,
      };
      return { suite: run.suite, result };
    },
  );
  return tests.map((test, suite): PolicySuiteResult => {
    const cases = outcomes
      .filter((outcome) => {
        return outcome.suite === suite;
      })
      .map((outcome) => {
        return outcome.result;
      });
    return {
      operation: test.operation,
      file: test.path,
      policy: policies.get(test.operation)?.source ?? null,
      cases,
    };
  });
}

/**
 * A decision as {@link describeDecision} words it: whether it allows, and the
 * code and rules of a refusal, each when known.
 */
type DescribedDecision = {
  readonly allowed: boolean;
  readonly code?: string | undefined;
  readonly violations?: readonly string[] | undefined;
};

/**
 * A decision in words.
 *
 * @param decision - The decision, expected or made.
 * @returns `allowed`, or refused with its code and its rules, each when known,
 *   so a mismatch in either shows on the line.
 */
function describeDecision(decision: DescribedDecision): string {
  if (decision.allowed) {
    return "allowed";
  }
  const violations = decision.violations ?? [];
  const rules = violations.length > 0 ? violations.join(", ") : undefined;
  const reason = [decision.code, rules]
    .filter((part) => {
      return part !== undefined;
    })
    .join(": ");
  if (reason === "") {
    return "refused";
  }
  return `refused (${reason})`;
}

/**
 * Where a test file's policy came from, as its heading names it.
 *
 * @param policy - Where the policy came from.
 * @param release - The release the run was told to test against, if any.
 * @returns The words for the heading.
 */
function describePolicy(policy: PolicySource, release: string | undefined): string {
  if (policy === null && release === undefined) {
    return "no policy file, nothing enforced";
  }
  if (policy === null) {
    return `release ${release} pins no policy, nothing enforced`;
  }
  if ("file" in policy) {
    return policy.file;
  }
  return `release ${release}, revision ${policy.revision_id}`;
}

/**
 * One case's line.
 *
 * @param testCase - The case's outcome.
 * @returns A tick and its name, or on a failure what was expected and what the
 *   server decided.
 */
function describeCase(testCase: PolicyCaseResult): string {
  if (testCase.passed) {
    return `  ✓ ${testCase.name}`;
  }
  const expected = describeDecision(testCase.expected);
  const actual = describeDecision({
    allowed: testCase.actual.allowed,
    code: testCase.actual.code,
    violations: Object.keys(testCase.actual.violations ?? {}),
  });
  return `  ✗ ${testCase.name}: expected ${expected}, got ${actual}`;
}

/**
 * The results for a terminal.
 *
 * @param results - Each test file's outcome.
 * @param release - The release the run was told to test against, if any.
 * @returns Each test file under a heading naming the policy it ran against, a
 *   line per case, and on a failed case what was expected and what the server
 *   decided; then the totals.
 */
export function renderPolicyTestResults(
  results: readonly PolicySuiteResult[],
  release?: string,
): string {
  const lines = results.flatMap((result) => {
    const heading = `${result.operation}  (${describePolicy(result.policy, release)})`;
    return [heading, ...result.cases.map(describeCase)];
  });
  const cases = results.flatMap((result) => {
    return result.cases;
  });
  const passed = cases.filter((testCase) => {
    return testCase.passed;
  }).length;
  const failed = cases.length - passed;
  const totals = failed === 0 ? `${passed} passed` : `${passed} passed, ${failed} failed`;
  return [...lines, "", totals].join("\n");
}
