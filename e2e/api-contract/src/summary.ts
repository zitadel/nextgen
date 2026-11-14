import type { Baseline } from "./baseline";
import type { FamilyRun } from "./lane";

/** One operation the API breaks its contract on, in the words a person needs to act on it. */
export interface Problem {
  family: string;
  operation: string;
  /** What is wrong, one entry per check: a new failure, or a listed one that stopped. */
  findings: string[];
}

/**
 * The lane's verdict as a page a person reads: what broke, where, how to see
 * the exact request, and how to fix or re-run it. It is written to the job
 * summary on GitHub, to `test-output/summary.md` everywhere, and as error
 * annotations on the check, so nobody has to open the raw log to find it.
 */
export class ContractSummary {
  private readonly runs: FamilyRun[];
  private readonly baseline: Baseline;

  /**
   * @param runs - what each family's Schemathesis run found.
   * @param baseline - the failures the API is known to have today.
   */
  constructor(runs: FamilyRun[], baseline: Baseline) {
    this.runs = runs;
    this.baseline = baseline;
  }

  /**
   * Each operation whose failures differ from the baseline.
   *
   * @returns the problems, in the order the families ran.
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
          found.push({ family: run.family, operation, findings });
        }
      }
    }
    return found;
  }

  /**
   * The summary as Markdown.
   *
   * @returns the page, which says so plainly when nothing broke.
   */
  markdown(): string {
    const problems = this.problems();
    const tested = this.runs.reduce((sum, run) => {
      return sum + run.accounting.tested;
    }, 0);
    if (problems.length === 0) {
      return `## API contract: passed\n\n${String(tested)} operations match the spec.\n`;
    }
    const lines = [
      "## API contract: broken",
      "",
      `${String(problems.length)} of ${String(tested)} operations do not match the spec.`,
      "",
    ];
    for (const problem of problems) {
      lines.push(`### \`${problem.operation}\` (${problem.family})`, "");
      for (const finding of problem.findings) {
        lines.push(`- ${finding}`);
      }
      lines.push("");
    }
    lines.push(
      "### What to do",
      "",
      "- The request that broke each check is in the `diagnostics` artifact of this run, under `e2e/api-contract/test-output/schemathesis/<family>/` (`report.json`, `output.log`).",
      "- Reproduce it on your machine: `turbo run api-contract --filter=@zitadel/e2e`.",
      "- A new failure means the server or the spec is wrong: fix one of them. Do not add the failure to `known-failures.json`.",
      "- A listed failure that stopped happening: delete its line from `e2e/api-contract/known-failures.json`.",
      "",
    );
    return lines.join("\n");
  }

  /**
   * GitHub workflow commands that show each problem on the check's page.
   *
   * @returns one `::error` line per problem.
   */
  annotations(): string[] {
    return this.problems().map((problem) => {
      const message = problem.findings.join(" ").replaceAll("%", "%25").replaceAll("\n", "%0A");
      return `::error title=API contract: ${problem.operation}::${message}`;
    });
  }
}
