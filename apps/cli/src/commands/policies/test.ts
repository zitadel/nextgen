import { PolicyService, ReleaseService } from "../../lib/backend";
import { Args } from "@oclif/core";

import { ZitadelError } from "../../lib/errors";
import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
  nonBlankString,
} from "../../lib/oclif";
import { POLICIES_DIR } from "../../lib/policies";
import {
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
  static override description = "Run the test cases in .zitadel/policies/ against the policies.";
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
    const { suites, issues } = await readPolicyTests(this.cwd, operations);
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
    const policyService = new PolicyService(client, projectId);
    const releaseService = new ReleaseService(client, projectId);
    const fromRelease =
      flags.release === undefined
        ? undefined
        : await policiesFromRelease(releaseService, policyService, flags.release);
    if (fromRelease?.revoked) {
      reportWarning(`Release ${flags.release} is revoked, so no origin serves its policies.`);
    }
    if (fromRelease && !fromRelease.pinsFlow) {
      // TODO(#2331): drop once runtime reads follow every release's pins.
      reportWarning(
        `Release ${flags.release} pins no flow, so sign-ins served it use the newest policy revisions, not the ones tested here.`,
      );
    }
    const source = fromRelease ?? (await policiesFromFiles(this.cwd, operations));
    if ("issues" in source && source.issues.length > 0) {
      throw new ZitadelError("E_VALIDATION", "The policy files are not valid", {
        details: { issues: source.issues },
        hint: source.issues.join("\n"),
      });
    }
    const policies = source.policies;

    const results = await runPolicyTests(policyService, suites, policies);
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
