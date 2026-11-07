import { readFileSync, writeFileSync } from "node:fs";

import type { FamilyRun } from "./lane";
import type { Failure } from "./report";

export interface KnownFailure {
  operation: string;
  check: string;
}

/**
 * The failures this API has today and is allowed to keep. It is a ratchet: a
 * failure that is not listed fails its operation's test, and so does a listed
 * one that no longer happens, so a fix removes its line and the list only
 * shrinks. `API_CONTRACT_UPDATE_BASELINE=1` rewrites it from a run.
 */
export class Baseline {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  read(): KnownFailure[] {
    return JSON.parse(readFileSync(this.path, "utf8")) as KnownFailure[];
  }

  write(failures: Failure[]): void {
    const known = failures.map(({ operation, check }) => {
      return { operation, check };
    });
    writeFileSync(this.path, `${JSON.stringify(known, null, 2)}\n`);
  }

  /**
   * What is wrong with `operation` against the baseline: each check it fails
   * that is not listed, and each listed one it no longer fails.
   */
  verdict(operation: string, failures: Failure[]): string[] {
    const listed = new Set(
      this.read()
        .filter((known) => {
          return known.operation === operation;
        })
        .map((known) => {
          return known.check;
        }),
    );
    const happening = new Set(
      failures.map((failure) => {
        return failure.check;
      }),
    );
    return [
      ...failures
        .filter((failure) => {
          return !listed.has(failure.check);
        })
        .map((failure) => {
          return `New failure: "${failure.check}" (${String(failure.count)} requests).`;
        }),
      ...[...listed]
        .filter((check) => {
          return !happening.has(check);
        })
        .map((check) => {
          return `"${check}" no longer fails. Remove it from known-failures.json to keep the ratchet.`;
        }),
    ];
  }

  /** The operations the baseline names that are not in `operations`. */
  unknownOperations(operations: Iterable<string>): string[] {
    const valid = new Set(operations);
    return [
      ...new Set(
        this.read()
          .map((known) => {
            return known.operation;
          })
          .filter((operation) => {
            return !valid.has(operation);
          }),
      ),
    ];
  }
}

/**
 * Rewrites the baseline from a set of runs, but only from runs that can be
 * trusted: one that errored, stopped early, or crashed has failures missing,
 * and writing it would silently drop them from the ratchet.
 */
export class BaselineUpdate {
  private readonly runs: FamilyRun[];

  constructor(runs: FamilyRun[]) {
    this.runs = runs;
  }

  /**
   * A run is trusted when it finished, did not error, ended with a result and
   * tested every operation it was asked to: the same accounting the suite
   * asserts, so a baseline is never written from a run the suite would reject.
   */
  private static trusted(run: FamilyRun): boolean {
    const { selected, tested, skipped, errored, unmatched } = run.accounting;
    return (
      run.complete &&
      run.errors.length === 0 &&
      [0, 1].includes(run.exitCode) &&
      selected === run.expected &&
      tested === run.expected &&
      skipped === 0 &&
      errored === 0 &&
      unmatched.length === 0
    );
  }

  apply(baseline: Baseline): void {
    const untrusted = this.runs.filter((run) => {
      return !BaselineUpdate.trusted(run);
    });
    if (untrusted.length > 0) {
      const families = untrusted.map((run) => {
        return run.family;
      });
      throw new Error(
        `refusing to rewrite the baseline from an unfinished run: ${families.join(", ")}`,
      );
    }
    baseline.write(
      this.runs.flatMap((run) => {
        return run.failures;
      }),
    );
  }
}
