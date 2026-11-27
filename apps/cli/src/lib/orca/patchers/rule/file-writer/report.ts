import type { PatchedFile } from "@/lib/orca/patchers/types";
import type { ScaffoldResult } from "./types";

/**
 * What making one change did: the artifact it touched, and what happened to it.
 */
export type Outcome = Readonly<{
  path: string;
  kind: PatchedFile["kind"];
  action: PatchedFile["action"] | "skip";
  /** The dependency the change added, if it added one. */
  dependency?: string;
}>;

/**
 * What a run has done so far.
 *
 * A report never changes, all the way down: its lists are frozen, and
 * {@link Report.with} answers the report that follows from one more
 * {@link Outcome}. A run is a fold of its outcomes.
 */
export class Report {
  readonly files: ReadonlyArray<PatchedFile>;
  readonly skipped: ReadonlyArray<string>;
  readonly dependencies: ReadonlyArray<string>;

  private constructor(
    parts: Readonly<{
      files: ReadonlyArray<PatchedFile>;
      skipped: ReadonlyArray<string>;
      dependencies: ReadonlyArray<string>;
    }>,
  ) {
    this.files = Object.freeze([...parts.files]);
    this.skipped = Object.freeze([...parts.skipped]);
    this.dependencies = Object.freeze([...parts.dependencies]);

    Object.freeze(this);
  }

  /**
   * @returns The report of a run that has done nothing yet.
   */
  static empty(): Report {
    return new Report({
      files: [],
      skipped: [],
      dependencies: [],
    });
  }

  /**
   * An artifact is recorded once, with the first action as the net one: several
   * ops can legitimately hit the same file (the base and framework op lists both
   * merge into `.env.local`, for example), and a file created and then extended
   * in the same run was created by the run.
   *
   * @param outcome - What making one change did.
   * @returns This report after that outcome.
   */
  with(outcome: Outcome): Report {
    const { path, kind, action, dependency } = outcome;
    const isSkip = action === "skip";
    const isRecorded = this.files.some((file) => {
      return file.path === path;
    });
    const isNew = !isSkip && !isRecorded;
    const files = isNew
      ? [
          ...this.files,
          Object.freeze({
            path,
            kind,
            action,
          }),
        ]
      : this.files;
    const skipped = isSkip ? [...this.skipped, path] : this.skipped;
    const dependencies =
      dependency === undefined ? this.dependencies : [...this.dependencies, dependency];

    return new Report({
      files,
      skipped,
      dependencies,
    });
  }

  /**
   * A path both written and later skipped as already-matching reports as
   * written. Directories stay in `files` rows (kind "dir") and out of the flat
   * `filesWritten` list.
   *
   * @param dryRun - Whether the run only reported what it would change.
   * @returns The run as callers read it, with every list frozen.
   */
  toResult(dryRun: boolean): ScaffoldResult {
    const recorded = new Set(
      this.files.map((file) => {
        return file.path;
      }),
    );
    const filesWritten = this.files
      .filter((file) => {
        return file.kind === "file";
      })
      .map((file) => {
        return file.path;
      });
    const filesSkipped = [...new Set(this.skipped)].filter((path) => {
      return !recorded.has(path);
    });

    return {
      dryRun,
      files: this.files,
      filesWritten: Object.freeze(filesWritten),
      filesSkipped: Object.freeze(filesSkipped),
      depsAdded: this.dependencies,
    };
  }
}
