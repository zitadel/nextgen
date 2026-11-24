import { Args } from "@oclif/core";

import { type PolicyEvaluation, PolicyService, ReleaseService } from "@/lib/backend";
import { ZitadelError } from "@/lib/errors";
import { mapBounded } from "@/lib/map-bounded";
import { CommandGroups } from "@/cli/commands/groups";
import { type Admitted, type CommandResult, nonBlankString } from "@/cli/core";
import { prose } from "@/lib/oclif/rendering";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { warnings } from "@/lib/ui";
import {
  CONFIG_DIRECTORIES,
  DiskStore,
  PASSWORD_POLICY_OPERATION,
  type PolicyCase,
  type PolicyCaseResult,
  type PolicyExpectation,
  type PolicyOperation,
  PolicyTest,
  USER_CREATE_POLICY_OPERATION,
  ZitadelConfig,
} from "@/lib/zitadel";
import { ProjectCommand } from "@/cli/commands/bases";

/**
 * Where a tested config came from: a policy file, a release's revision, or
 * nowhere.
 *
 * @remarks
 * The shape is the `--json` output's, so each source is told apart by the key
 * it carries rather than by a `kind`.
 */
export type PolicySource = { readonly file: string } | { readonly revision_id: string } | null;

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
 * One operation's evaluate request.
 *
 * @typeParam Operation - The operation.
 */
type EvaluationOf<Operation extends PolicyOperation> = Extract<
  PolicyEvaluation,
  { operation: Operation }
>;

/**
 * One case to evaluate, and the test file it belongs to.
 */
type CaseRun = {
  /**
   * The test file's position among the files.
   */
  readonly suite: number;

  /**
   * The case.
   */
  readonly testCase: PolicyCase;

  /**
   * The evaluate request the case sends, in its operation's own shape.
   */
  readonly request: PolicyEvaluation;
};

/**
 * How many evaluate requests a run keeps in flight at once.
 */
const EVALUATE_CONCURRENCY = 8;

/**
 * `zitadel policy test` — evaluate the cases in
 * `.zitadel/policies/<operation>.test.json` on the server.
 *
 * @remarks
 * Against the sibling policy files by default, or with `--release` against
 * the revisions a built release pins. Neither present means no policy: the
 * cases are evaluated with `{}`, which is what the server enforces then (only
 * its own guards), so a case that expects a refusal shows what would get
 * through. The server evaluates every case with the live operation's own check
 * (`POST /policies/evaluate`); the CLI never evaluates a policy itself, and
 * nothing is read from or written to the project's policies. A failing case
 * fails the command with `E_VALIDATION`, carrying the full results.
 */
export default class PolicyTestCommand extends ProjectCommand {
  static override description = `Run the test cases in .zitadel/policies/ against the policies.

A policy's cases live beside it in <operation>.test.json, such as auth.factor.password.set.test.json: each case holds an input, such as a password, and the decision you expect. Inputs go in that file, not on the command line. https://preview.zitadel.com/docs/guides/test-policies walks through an example.

The server evaluates every case, so the command needs a connection to it. By default the cases run against the policy files in .zitadel/policies/; --release runs them against the policies a release pins. Testing publishes nothing and leaves the live policies as they are.`;
  static override group = CommandGroups.signIn;
  static override groupOrder = 6;

  static override examples = [
    "<%= config.bin %> policy test",
    "<%= config.bin %> policy test auth.factor.password.set",
    "<%= config.bin %> policy test --release rel_01KXB7C2M4N7F0N9WD3P2E4YM7",
    "<%= config.bin %> policy test --json",
  ];
  static override args = {
    operation: Args.string({
      required: false,
      description: "Test only this operation's policy, such as auth.factor.password.set.",
    }),
  };
  static override flags = {
    release: nonBlankString({
      description:
        "Test the policies a release pins (rel_…) instead of the files in .zitadel/policies/.",
    }),
  };

  /**
   * Evaluate the test cases and report each one. When a case fails the results
   * are the explanation: the hint shows them on a terminal, and under `--json`
   * they travel in the error's details. The cases run against a release's
   * policies, warning when it is revoked, or the project's files.
   *
   * @param input.args - The operation to test, if only one.
   * @param input.flags - `--release`.
   * @returns The results.
   * @throws {@link ZitadelError} With `E_VALIDATION` when a test or policy file
   *   is not valid, or a case fails.
   */
  protected async execute({
    args,
    flags,
  }: Admitted<typeof PolicyTestCommand>): Promise<CommandResult> {
    const operations = args.operation === undefined ? [] : [args.operation];
    const config = await ZitadelConfig.loadKinds(new DiskStore(this.cwd), ["policies"]);
    const selected = config.policies.selectTests(operations);
    const tests = selected.documents;
    if (selected.issues.length > 0) {
      throw new ZitadelError("E_VALIDATION", "The policy test files are not valid", {
        details: { issues: selected.issues },
        hint: selected.issues.join("\n"),
      });
    }
    if (tests.length === 0) {
      const directory = CONFIG_DIRECTORIES.policies;

      return {
        status: "skipped",
        reason: "no-policy-tests",
        pretty: prose(
          `No policy test files in ${directory}/. Add <operation>.test.json beside a policy; ${directory}/README.md shows one.`,
        ),
        summary: {
          title: `No policy test files in ${directory}`,
          sections: [],
          lines: [`Add <operation>.test.json beside a policy; ${directory}/README.md shows one.`],
        },
      };
    }

    const policyService = await this.service(PolicyService);
    const releaseService = await this.service(ReleaseService);
    const policyFiles =
      flags.release === undefined ? config.policies.selectPolicies(operations) : undefined;
    if (policyFiles !== undefined && policyFiles.issues.length > 0) {
      throw new ZitadelError("E_VALIDATION", "The policy files are not valid", {
        details: { issues: policyFiles.issues },
        hint: policyFiles.issues.join("\n"),
      });
    }
    const fromRelease =
      flags.release === undefined
        ? undefined
        : await this.policiesFromRelease(releaseService, policyService, flags.release);
    if (fromRelease?.revoked) {
      warnings.report(`Release ${flags.release} is revoked, so no origin serves its policies.`);
    }
    const policies: ReadonlyMap<string, PolicyUnderTest> =
      fromRelease?.policies ??
      new Map(
        (policyFiles?.documents ?? []).map((policy): readonly [string, PolicyUnderTest] => {
          const underTest: PolicyUnderTest = {
            config: policy.config,
            source: { file: policy.path },
          };
          return [policy.operation, underTest];
        }),
      );

    const results = await this.runPolicyTests(policyService, tests, policies);
    const cases = results.flatMap((result) => {
      return result.cases;
    });
    const failed = cases.filter((testCase) => {
      return !testCase.passed;
    }).length;
    const source = flags.release === undefined ? "files" : "release";
    this.recordTelemetry({
      policy_source: source,
      case_count: cases.length,
      failed_count: failed,
    });

    const data = {
      source,
      release_id: flags.release,
      operations: results,
      passed: cases.length - failed,
      failed,
    };
    const pretty = this.renderPolicyTestResults(results, flags.release);
    if (failed > 0) {
      throw new ZitadelError(
        "E_VALIDATION",
        `${failed} of ${cases.length} policy test cases failed`,
        {
          details: data,
          hint: pretty,
        },
      );
    }

    const title = `${cases.length} passed`;

    return {
      status: "ok",
      data: { title, ...data },
      pretty: prose(pretty),
      summary: {
        title,
        sections: [],
        lines: escapeControlCharacters(pretty).split("\n").slice(0, -2),
      },
    };
  }

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
   * @throws {@link ZitadelError} When the server cannot answer for the release
   *   or a revision it pins.
   */
  private async policiesFromRelease(
    releases: ReleaseService,
    service: PolicyService,
    releaseId: string,
  ): Promise<{
    /**
     * The policies the release pins, by operation.
     */
    readonly policies: ReadonlyMap<string, PolicyUnderTest>;

    /**
     * Whether the release is revoked, so its policies serve no origin.
     */
    readonly revoked: boolean;
  }> {
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
   * The evaluate request of every case of a test file, in its operation's own
   * shape: the input, the facts where the operation has any, and the rules.
   *
   * @remarks
   * A case without facts sends none: the key is dropped on the wire. The case
   * holds its facts read-only, so the request takes its own copy of the list.
   *
   * The rules were read for this operation, which the policies are keyed by,
   * so they hold this operation's settings, and the server checks them as a
   * deploy would.
   *
   * @param test - The test file.
   * @param suite - Its position among the files.
   * @param config - The rules of its operation's policy; `{}` when there is none.
   * @returns One run per case, in the file's order.
   */
  private caseRuns(
    test: PolicyTest,
    suite: number,
    config: PolicyEvaluation["config"],
  ): readonly CaseRun[] {
    const value = test.value;
    switch (value.operation) {
      case PASSWORD_POLICY_OPERATION: {
        const operation = value.operation;
        const settings = config as EvaluationOf<typeof operation>["config"];
        return value.cases.map((testCase): CaseRun => {
          const facts = testCase.facts;
          return {
            suite,
            testCase,
            request: {
              operation,
              config: settings,
              input: testCase.input,
              facts:
                facts === undefined
                  ? undefined
                  : {
                      ...facts,
                      history_matches: facts.history_matches?.slice(),
                    },
            },
          };
        });
      }
      case USER_CREATE_POLICY_OPERATION: {
        const operation = value.operation;
        const settings = config as EvaluationOf<typeof operation>["config"];
        return value.cases.map((testCase): CaseRun => {
          return {
            suite,
            testCase,
            request: {
              operation,
              config: settings,
              input: testCase.input,
            },
          };
        });
      }
    }
  }

  /**
   * Evaluate every case of every test file against its operation's policy, or
   * `{}` when there is none.
   *
   * @remarks
   * One request per case, a few in flight at once. Protected rather than
   * private so its unit test can reach it through a subclass.
   *
   * @param service - Where each case is evaluated.
   * @param tests - The test files, each sound.
   * @param policies - The policy each operation is evaluated against.
   * @returns Each test file's outcome, in file and case order.
   * @throws {@link ZitadelError} When the server cannot evaluate a case.
   */
  protected async runPolicyTests(
    service: PolicyService,
    tests: readonly PolicyTest[],
    policies: ReadonlyMap<string, PolicyUnderTest>,
  ): Promise<readonly PolicySuiteResult[]> {
    const runs = tests.flatMap((test, suite) => {
      return this.caseRuns(test, suite, policies.get(test.operation)?.config ?? {});
    });
    const outcomes = await mapBounded(
      runs,
      EVALUATE_CONCURRENCY,
      async (run): Promise<{ readonly suite: number; readonly result: PolicyCaseResult }> => {
        const actual = await service.evaluate(run.request);
        return {
          suite: run.suite,
          result: PolicyTest.resultOf(run.testCase, actual),
        };
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
      const operation = test.operation;
      return {
        operation,
        file: test.path,
        policy: policies.get(operation)?.source ?? null,
        cases,
      };
    });
  }

  /**
   * The results for a terminal.
   *
   * @remarks
   * Protected rather than private so its unit test can reach it through a
   * subclass.
   *
   * @param results - Each test file's outcome.
   * @param release - The release the run was told to test against, if any.
   * @returns Each test file under a heading naming where its policy came from
   *   (a file, a release's revision, or none, so nothing is enforced), a line
   *   per case, and on a failed case what was expected and what the server
   *   decided; then the totals.
   */
  protected renderPolicyTestResults(
    results: readonly PolicySuiteResult[],
    release?: string,
  ): string {
    const lines = results.flatMap((result) => {
      const policy = result.policy;
      const origin =
        policy === null && release === undefined
          ? "no policy file, nothing enforced"
          : policy === null
            ? `release ${release} pins no policy, nothing enforced`
            : "file" in policy
              ? policy.file
              : `release ${release}, revision ${policy.revision_id}`;
      return [
        `${result.operation}  (${origin})`,
        ...result.cases.map((testCase) => {
          if (testCase.passed) {
            return `  ✓ ${testCase.name}`;
          }
          const expected = this.describeDecision(testCase.expected);
          const actual = this.describeDecision({
            allowed: testCase.actual.allowed,
            code: testCase.actual.code,
            violations: Object.keys(testCase.actual.violations ?? {}),
          });
          return `  ✗ ${testCase.name}: expected ${expected}, got ${actual}`;
        }),
      ];
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

  /**
   * A decision in words.
   *
   * @param decision - The decision, expected or made.
   * @returns `allowed`, or refused with its code and its rules, each when known,
   *   so a mismatch in either shows on the line.
   */
  private describeDecision(decision: {
    readonly allowed: boolean;
    readonly code?: string | undefined;
    readonly violations?: PolicyExpectation["violations"] | undefined;
  }): string {
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
}
