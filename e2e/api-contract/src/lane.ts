import { mkdir, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { join } from "node:path";

import { compare } from "./order";
import { CHECKS, exemptionsFor, refusalsFor } from "./checks";
import type { Credential, Credentials } from "./credentials";
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
  /** How long the family's Schemathesis run took, in seconds. */
  seconds: number;
}

/** The phases that look at one operation at a time, and so can be split across containers. */
const PER_OPERATION_PHASES = ["examples", "coverage", "fuzzing"];

/** The phase that chains operations together, and so needs them all in one run. */
const STATEFUL_PHASES = ["stateful"];

/** A family with this many operations or more is split. */
const SHARD_FROM = 30;

/**
 * How many slices a big family is split into: `API_CONTRACT_SHARDS`, else 4,
 * never more than the cores there are (each container is about one core) and
 * never less than 1.
 */
const SHARDS = Math.max(
  1,
  Math.floor(Number(process.env.API_CONTRACT_SHARDS)) || Math.min(4, availableParallelism()),
);

/**
 * Waits for every promise, then throws the first failure. `Promise.all` would
 * throw at once and let the caller tear the instance down under runs that are
 * still going.
 */
async function allSettled<T>(promises: readonly Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(promises);
  const failed = settled.find((result): result is PromiseRejectedResult => {
    return result.status === "rejected";
  });
  if (failed) {
    throw failed.reason;
  }
  return settled.map((result) => {
    return (result as PromiseFulfilledResult<T>).value;
  });
}

function sum(
  parts: readonly { run: SchemathesisRun }[],
  read: (run: SchemathesisRun) => number,
): number {
  return parts.reduce((total, part) => {
    return total + read(part.run);
  }, 0);
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

  /**
   * Runs every family at the same time. They share the instance but not state:
   * each has credentials and a user of its own, and the operations of one
   * family are the ones no other family calls.
   */
  async run(): Promise<FamilyRun[]> {
    // Credentials are minted one at a time: two sessions seeded at once would
    // share the instance's seeding helper.
    const credentials = new Map<Family, Credential>();
    for (const family of FAMILIES) {
      if (this.input.spec.operationsOf(family).length > 0) {
        credentials.set(family, await this.input.credentials.forFamily(family));
      }
    }
    const runs = await allSettled(
      FAMILIES.map((family) => {
        return this.runFamily(family, credentials.get(family));
      }),
    );
    return runs.filter((run): run is FamilyRun => {
      return run !== undefined;
    });
  }

  private async runFamily(
    family: Family,
    credential: Credential | undefined,
  ): Promise<FamilyRun | undefined> {
    const operations = this.input.spec.operationsOf(family);
    if (operations.length === 0 || credential === undefined) {
      return undefined;
    }
    this.input.log(`${family}: ${String(operations.length)} operations`);
    const started = Date.now();
    const ids = operations.map((operation) => {
      return operation.id;
    });
    const shared = {
      baseUrl: this.input.baseUrl,
      spec: this.input.specText,
      headers: credential.headers,
      schemes: credential.schemes,
      checks: CHECKS,
      exemptions: exemptionsFor(operations),
      refusals: refusalsFor(operations),
    };
    const slices = Lane.slices(ids);
    const parts =
      slices.length === 1
        ? [{ name: ".", operationIds: ids, phases: undefined }]
        : [
            ...slices.map((slice, index) => {
              return {
                name: `shard-${String(index + 1)}`,
                operationIds: slice,
                phases: PER_OPERATION_PHASES,
              };
            }),
            { name: "stateful", operationIds: ids, phases: STATEFUL_PHASES },
          ];
    const runs = await allSettled(
      parts.map(async (part) => {
        const run = await this.input.runner.run({
          ...shared,
          workDir: join(this.input.workDir, family, part.name),
          operationIds: part.operationIds,
          phases: part.phases,
        });
        await this.keep(join(family, part.name), run);
        return { part, run };
      }),
    );
    this.input.log(`${family}: done in ${String(Math.round((Date.now() - started) / 1000))}s`);
    // The slices cover every operation once; the stateful run repeats them, so
    // only the slices say what was tested.
    const counted = runs.filter(({ part }) => {
      return part.name !== "stateful";
    });
    const failures = new Map<string, Failure>();
    for (const { run } of runs) {
      for (const failure of run.report.failures()) {
        const named =
          failure.operation === STATEFUL
            ? { ...failure, operation: Lane.statefulName(family) }
            : failure;
        const key = `${named.operation}\n${named.check}`;
        failures.set(key, { ...named, count: (failures.get(key)?.count ?? 0) + named.count });
      }
    }
    const incomplete = runs.find(({ run }) => {
      return !run.report.complete;
    });
    return {
      family,
      operations: [
        ...operations.map((operation) => {
          return operation.name;
        }),
        Lane.statefulName(family),
      ],
      expected: operations.length,
      accounting: {
        selected: sum(counted, (run) => run.report.accounting.selected),
        tested: sum(counted, (run) => run.report.accounting.tested),
        skipped: sum(counted, (run) => run.report.accounting.skipped),
        errored: sum(counted, (run) => run.report.accounting.errored),
        unmatched: counted.flatMap(({ run }) => {
          return run.report.accounting.unmatched;
        }),
      },
      exitCode:
        runs.find(({ run }) => {
          return run.exitCode !== 0 && run.exitCode !== 1;
        })?.run.exitCode ?? Math.max(...runs.map(({ run }) => run.exitCode)),
      log: runs
        .map(({ run }) => {
          return run.log.split("\n").slice(-30).join("\n");
        })
        .join("\n"),
      complete: incomplete === undefined,
      stopReason: incomplete?.run.report.stopReason ?? runs[0]?.run.report.stopReason ?? "unknown",
      errors: runs.flatMap(({ run }) => {
        return run.report.errors;
      }),
      seconds: Math.round((Date.now() - started) / 100) / 10,
      failures: [...failures.values()].sort((a, b) => {
        return compare(a.operation, b.operation) || compare(a.check, b.check);
      }),
    };
  }

  /**
   * The operations of a big family dealt out round-robin, so each slice gets a
   * similar mix. A small family is one slice, because starting a container
   * costs more than the time a split would save.
   */
  static slices(ids: readonly string[]): string[][] {
    if (ids.length < SHARD_FROM) {
      return [[...ids]];
    }
    const slices: string[][] = Array.from({ length: SHARDS }, () => {
      return [];
    });
    ids.forEach((id, index) => {
      slices[index % SHARDS]?.push(id);
    });
    return slices;
  }

  /** Kept in the ignored test-output folder, so a failing run can be read in full and replayed. */
  private async keep(directoryName: string, run: SchemathesisRun): Promise<void> {
    const directory = join(this.input.artifactsDir, directoryName);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "report.json"), run.reportText);
    await writeFile(join(directory, "output.log"), run.log);
  }
}
