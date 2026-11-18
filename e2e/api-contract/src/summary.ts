import type { Baseline } from "./baseline";
import type { CommandRun } from "./contract";
import type { FailureDetail } from "./details";
import type { SourceLocation } from "./sources";

/** One operation the API breaks its contract on, in the words a person needs to act on it. */
export interface Problem {
  command: string;
  operation: string;
  /** What is wrong, one entry per check: a new failure, or a listed one that stopped. */
  findings: string[];
  /** The failing requests Schemathesis printed for it, when it printed any. */
  details: FailureDetail[];
}

/** At most this many failing requests are shown for one operation. */
const DETAILS_SHOWN = 2;

/** GitHub workflow commands carry their text with these characters escaped. */
function escapeData(text: string): string {
  return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function escapeProperty(text: string): string {
  return escapeData(text).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

/**
 * The lane's verdict, written for each place a person meets it: Markdown for
 * the run's summary page, plain text for the log and the failing test,
 * and error annotations on the check. Each says what broke, shows the request
 * and response that broke it, and how to run it again, so nobody has to
 * download anything to find out.
 */
export class ContractSummary {
  private readonly runs: CommandRun[];
  private readonly baseline: Baseline;

  /**
   * @param runs - what each Schemathesis command found.
   * @param baseline - the failures the API is known to have today.
   */
  constructor(runs: CommandRun[], baseline: Baseline) {
    this.runs = runs;
    this.baseline = baseline;
  }

  /**
   * Each operation whose failures differ from the baseline.
   *
   * @returns the problems, in the order the commands ran.
   */
  problems(): Problem[] {
    const found: Problem[] = [];
    for (const run of this.runs) {
      for (const operation of run.operations) {
        const findings = this.baseline.verdict(
          operation,
          run.failures.filter((failure) => {
            return failure.operation === operation;
          }),
        );
        if (findings.length > 0) {
          found.push({
            command: run.name,
            operation,
            findings,
            details: (run.details[operation] ?? []).slice(0, DETAILS_SHOWN),
          });
        }
      }
    }
    return found;
  }

  private tested(): number {
    return this.runs.reduce((sum, run) => {
      return sum + (run.counted ? run.accounting.tested : 0);
    }, 0);
  }

  /**
   * The summary as Markdown, for the run's summary page.
   *
   * @returns the page, which says so plainly when nothing broke.
   */
  markdown(): string {
    const problems = this.problems();
    const tested = this.tested();
    const timing = this.timing();
    if (problems.length === 0) {
      return `## API contract: passed\n\n${String(tested)} operations match the spec.\n\n${timing}`;
    }
    const lines = [
      "## API contract: broken",
      "",
      `${String(problems.length)} of ${String(tested)} operations do not match the spec.`,
      "",
    ];
    for (const problem of problems) {
      lines.push(`### \`${problem.operation}\``, "");
      for (const finding of problem.findings) {
        lines.push(`- ${finding}`);
      }
      lines.push("");
      for (const detail of problem.details) {
        lines.push("```", ...this.detailLines(detail), "```", "");
      }
    }
    lines.push(
      "### What to do",
      "",
      "- A new failure means the server or the spec is wrong: fix one of them. Do not add the failure to `known-failures.json`.",
      "- A listed failure that stopped happening: delete its line from `e2e/api-contract/known-failures.json`.",
      "- Run it again on your machine: `turbo run api-contract --filter=@zitadel/e2e`. The full output of each command is in the `diagnostics` artifact of the run, under `e2e/api-contract/test-output/schemathesis/<command>/`.",
      "",
      timing,
    );
    return lines.join("\n");
  }

  /** What one failing request looks like: the response, the request and how to replay it. */
  private detailLines(detail: FailureDetail): string[] {
    return [
      ...(detail.response === "" ? [] : [detail.response, ""]),
      ...(detail.curl === "" ? [] : [detail.curl, ""]),
      `st replay ${detail.id}   (inside the Schemathesis image)`,
    ];
  }

  /**
   * The verdict as plain text, for the log and for the message of the failing
   * test. A log does not render Markdown, so there is none in it.
   *
   * @returns the text, which says so plainly when nothing broke.
   */
  text(): string {
    const problems = this.problems();
    if (problems.length === 0) {
      return `API contract: passed. ${String(this.tested())} operations match the spec.`;
    }
    const lines = [
      `API contract: broken. ${String(problems.length)} of ${String(this.tested())} operations do not match the spec.`,
      "",
    ];
    for (const problem of problems) {
      lines.push(problem.operation);
      for (const finding of problem.findings) {
        lines.push(`  ${finding}`);
      }
      for (const detail of problem.details) {
        lines.push(
          ...this.detailLines(detail).map((line) => {
            return line === "" ? "" : `    ${line}`;
          }),
        );
      }
      lines.push("");
    }
    lines.push(
      "A new failure means the server or the spec is wrong: fix one of them, and do not add it to known-failures.json.",
      "A listed failure that stopped happening: delete its line from e2e/api-contract/known-failures.json.",
    );
    return lines.join("\n");
  }

  /**
   * How long each command took, which is where a slow run spends its time.
   *
   * @returns a Markdown table.
   */
  timing(): string {
    const rows = this.runs.map((run) => {
      const what = run.counted ? String(run.expected) : "multi-step phase";
      return `| ${run.name} | ${what} | ${String(run.seconds)}s |`;
    });
    const slowest = Math.max(
      0,
      ...this.runs.map((run) => {
        return run.seconds;
      }),
    );
    return [
      "### Time",
      "",
      "| Command | Operations | Took |",
      "| --- | --- | --- |",
      ...rows,
      `| all of them (they run at the same time, so this is the slowest) | | ${String(slowest)}s |`,
      "",
    ].join("\n");
  }

  /**
   * GitHub workflow commands that show each problem on the check's page, on
   * the pull request's Checks tab and, for a file the pull request changes, on
   * the line of the diff.
   *
   * @param locate - where an operation is defined in the spec's source, so the annotation points there.
   * @returns one `::error` line per problem.
   */
  annotations(
    locate: (operation: string) => SourceLocation | undefined = () => undefined,
  ): string[] {
    return this.problems().map((problem) => {
      const where = locate(problem.operation);
      const message = [
        ...problem.findings,
        ...problem.details.flatMap((detail) => {
          return ["", ...this.detailLines(detail)];
        }),
      ].join("\n");
      const properties = [
        ...(where ? [`file=${escapeProperty(where.file)}`, `line=${String(where.line)}`] : []),
        `title=${escapeProperty(`API contract: ${problem.operation}`)}`,
      ];
      return `::error ${properties.join(",")}::${escapeData(message)}`;
    });
  }
}
