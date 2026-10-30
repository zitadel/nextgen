import { Args, Flags } from "@oclif/core";

import { ZitadelError } from "../../lib/errors";
import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../../lib/oclif";
import { POLICIES_DIR } from "../../lib/policies";
import {
  type PolicyUnderTest,
  policiesFromFiles,
  policiesFromRelease,
  readPolicyTests,
  renderPolicyTestResults,
  runPolicyTests,
} from "../../lib/policies/tests";
import { reportWarning } from "../../lib/warnings";

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
  static override description = "Run the test cases in .zitadel/policies/ against the policies";
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
    release: Flags.string({
      description:
        "Test the policies a release pins (rel_…) instead of the files in .zitadel/policies/.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(PoliciesTest);
    await this.toMeta(flags);
    const { cwd } = this.meta;

    const operations = args.operation === undefined ? [] : [args.operation];
    const { suites, issues } = await readPolicyTests(cwd, operations);
    if (issues.length > 0) {
      throw new ZitadelError("E_VALIDATION", "The policy test files are not valid", {
        details: { issues },
        hint: issues.join("\n"),
      });
    }
    if (suites.length === 0) {
      return this.emit({
        status: "skipped",
        reason: "no-policy-tests",
        pretty: `No policy test files in ${POLICIES_DIR}/. Add <operation>.test.json beside a policy; ${POLICIES_DIR}/README.md shows one.`,
      });
    }

    const { client, projectId } = await this.connect();
    let policies: Map<string, PolicyUnderTest>;
    if (flags.release === undefined) {
      const fromFiles = await policiesFromFiles(cwd, operations);
      if (fromFiles.issues.length > 0) {
        throw new ZitadelError("E_VALIDATION", "The policy files are not valid", {
          details: { issues: fromFiles.issues },
          hint: fromFiles.issues.join("\n"),
        });
      }
      policies = fromFiles.policies;
    } else {
      const fromRelease = await policiesFromRelease(client, projectId, flags.release);
      if (fromRelease.revoked) {
        reportWarning(`Release ${flags.release} is revoked, so no origin serves its policies.`);
      }
      policies = fromRelease.policies;
    }

    const results = await runPolicyTests(client, projectId, suites, policies);
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
    return this.emit({ status: "ok", data, pretty });
  }
}
