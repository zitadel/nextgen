import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { checksFor } from "./checks";
import type { Credentials } from "./credentials";
import type { Accounting, Failure } from "./report";
import type { SchemathesisInput, SchemathesisRun } from "./schemathesis";
import { FAMILIES, type Family, type OpenApiSpec } from "./spec";

/** What the suite reads about one family's Schemathesis run. */
export interface FamilyRun {
  family: Family;
  /** The `METHOD /path` names of the operations the family holds, then its multi-step test. */
  operations: string[];
  /** How many operations the run was asked to test. */
  expected: number;
  /** What Schemathesis says it did with them. */
  accounting: Accounting;
  exitCode: number;
  /** The tail of what Schemathesis printed, for the failure message of a run that crashed. */
  log: string;
  complete: boolean;
  stopReason: string;
  errors: string[];
  failures: Failure[];
}

/** What Schemathesis files the failures of its multi-step phase under, which belong to no single operation. */
const STATEFUL = "Stateful tests";

export interface Runner {
  run(input: SchemathesisInput): Promise<SchemathesisRun>;
}

export interface LaneInput {
  spec: OpenApiSpec;
  /** The spec exactly as the server served it. */
  specText: string;
  baseUrl: string;
  credentials: Credentials;
  runner: Runner;
  /** A scratch folder; each family works in a folder of its own inside it. */
  workDir: string;
  /** Where each family's raw report and output are kept for a person to read. */
  artifactsDir: string;
  /** Progress lines; the setup prints them, the unit tests drop them. */
  log: (message: string) => void;
}

/**
 * Runs Schemathesis once for each family of operations, each with the
 * credentials that family answers to, and keeps what each run printed and
 * reported.
 */
export class Lane {
  private readonly input: LaneInput;

  constructor(input: LaneInput) {
    this.input = input;
  }

  /** The name a family's multi-step failures are filed and tested under, so two families never share one. */
  static statefulName(family: Family): string {
    return `${STATEFUL} (${family})`;
  }

  async run(): Promise<FamilyRun[]> {
    const runs: FamilyRun[] = [];
    for (const family of FAMILIES) {
      const operations = this.input.spec.operationsOf(family);
      if (operations.length === 0) {
        continue;
      }
      this.input.log(`${family}: ${String(operations.length)} operations`);
      const credential = await this.input.credentials.forFamily(family);
      const run = await this.input.runner.run({
        workDir: join(this.input.workDir, family),
        spec: this.input.specText,
        baseUrl: this.input.baseUrl,
        headers: credential.headers,
        schemes: credential.schemes,
        checks: checksFor(family),
        operationIds: operations.map((operation) => {
          return operation.id;
        }),
      });
      await this.keep(family, run);
      runs.push({
        family,
        operations: [
          ...operations.map((operation) => {
            return operation.name;
          }),
          Lane.statefulName(family),
        ],
        expected: operations.length,
        accounting: run.report.accounting,
        exitCode: run.exitCode,
        log: run.log.split("\n").slice(-30).join("\n"),
        complete: run.report.complete,
        stopReason: run.report.stopReason,
        errors: run.report.errors,
        failures: run.report.failures().map((failure) => {
          return failure.operation === STATEFUL
            ? { ...failure, operation: Lane.statefulName(family) }
            : failure;
        }),
      });
    }
    return runs;
  }

  /** Kept in the ignored test-output folder, so a failing run can be read in full and replayed. */
  private async keep(family: Family, run: SchemathesisRun): Promise<void> {
    const directory = join(this.input.artifactsDir, family);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "report.json"), run.reportText);
    await writeFile(join(directory, "output.log"), run.log);
  }
}
