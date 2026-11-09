import { PolicyService, ReleaseService } from "@/lib/backend";
import { Args } from "@oclif/core";

import { ZitadelError } from "@/lib/errors";
import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
  nonBlankString,
} from "@/lib/oclif";
import {
  type PolicyUnderTest,
  policiesFromRelease,
  renderPolicyTestResults,
  runPolicyTests,
} from "@/lib/policies/tests";
import { reportWarning } from "@/lib/warnings";
import { prose } from "@/lib/oclif/rendering";
import { DiskStore, ZitadelConfig, CONFIG_DIRECTORIES } from "@/lib/zitadel";

/**
 * `zitadel policies test` — evaluate the cases in
 * `.zitadel/policies/<operation>.test.json` on the server (#1445).
 *
 * Against the sibling policy files by default, or with `--release` against
 * the revisions a built release pins. The server evaluates every case with
 * the live operation's own check (`POST /policies/evaluate`); nothing is read
 * from or written to the project's policies. A failing case fails the
 * command with `E_VALIDATION`, carrying the full results.
 */
export default class PoliciesTest extends EnvironmentCommand {
  static override description = `Run the test cases in .zitadel/policies/ against the policies.

A policy's cases live beside it in <operation>.test.json, such as auth.factor.password.set.test.json: each case holds an input, such as a password, and the decision you expect. Inputs go in that file, not on the command line. https://preview.zitadel.com/docs/guides/test-policies walks through an example.

The server evaluates every case, so the command needs a connection to it. By default the cases run against the policy files in .zitadel/policies/; --release runs them against the policies a release pins. Testing publishes nothing and leaves the live policies as they are.`;
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> policies test",
    "<%= config.bin %> policies test auth.factor.password.set",
    "<%= config.bin %> policies test --release rel_01KXB7C2M4N7F0N9WD3P2E4YM7",
    "<%= config.bin %> policies test --json",
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

  protected async execute({ args, flags }: Admitted<typeof PoliciesTest>): Promise<JsonEnvelope> {
    const operations = args.operation === undefined ? [] : [args.operation];
    const config = await ZitadelConfig.loadUnchecked(new DiskStore(this.cwd));
    const { documents: tests, issues } = config.policies.testsFor(operations);
    if (issues.length > 0) {
      throw new ZitadelError("E_VALIDATION", "The policy test files are not valid", {
        details: { issues },
        hint: issues.join("\n"),
      });
    }
    if (tests.length === 0) {
      return this.emit({
        status: "skipped",
        reason: "no-policy-tests",
        pretty: prose(
          `No policy test files in ${CONFIG_DIRECTORIES.policies}/. Add <operation>.test.json beside a policy; ${CONFIG_DIRECTORIES.policies}/README.md shows one.`,
        ),
      });
    }

    const { client, projectId } = await this.connect();
    const policyService = new PolicyService(client, projectId);
    const releaseService = new ReleaseService(client, projectId);
    const fromRelease =
      flags.release === undefined
        ? undefined
        : await policiesFromRelease(releaseService, policyService, flags.release);
    if (fromRelease?.revoked) {
      reportWarning(`Release ${flags.release} is revoked, so no origin serves its policies.`);
    }
    const policies = fromRelease?.policies ?? this.policiesFromFiles(config, operations);

    const results = await runPolicyTests(policyService, tests, policies);
    const cases = results.flatMap((result) => result.cases);
    const failed = cases.filter((testCase) => !testCase.passed).length;
    this.recordTelemetry({
      policy_source: flags.release === undefined ? "files" : "release",
      case_count: cases.length,
      failed_count: failed,
    });

    const data = {
      source: flags.release === undefined ? "files" : "release",
      ...(flags.release === undefined ? {} : { release_id: flags.release }),
      operations: results,
      passed: cases.length - failed,
      failed,
    };
    const pretty = renderPolicyTestResults(results, flags.release);
    if (failed > 0) {
      // The results are the explanation: the hint shows them on a terminal,
      // and under --json they travel in the error's details.
      throw new ZitadelError(
        "E_VALIDATION",
        `${failed} of ${cases.length} policy test cases failed`,
        { details: data, hint: pretty },
      );
    }

    return this.emit({
      status: "ok",
      data,
      pretty: prose(pretty),
    });
  }

  /**
   * The project's policies of some operations, to test against.
   *
   * @param config - The project's configuration.
   * @param operations - The operations to read the policies of; every one when empty.
   * @returns The rules of each operation's policy file, by operation.
   * @throws {@link ZitadelError} With `E_VALIDATION` when a policy file asked
   *   for has a problem, naming each one.
   */
  private policiesFromFiles(
    config: ZitadelConfig,
    operations: readonly string[],
  ): ReadonlyMap<string, PolicyUnderTest> {
    const { documents, issues } = config.policies.for(operations);
    if (issues.length > 0) {
      throw new ZitadelError("E_VALIDATION", "The policy files are not valid", {
        details: { issues },
        hint: issues.join("\n"),
      });
    }
    return new Map(
      documents.map((policy): [string, PolicyUnderTest] => {
        return [
          policy.readOperation(),
          { config: policy.readConfig(), source: { file: policy.path } },
        ];
      }),
    );
  }
}
