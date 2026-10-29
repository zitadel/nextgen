import type { GitResult } from "./git";
import type { DiffedFile, PathFilter } from "./types";

/** One changed file, as `git diff --name-status` lists it. */
export class Change {
  readonly path: string;
  readonly status: DiffedFile["status"];
  /** Where a renamed or copied file came from. */
  readonly previousPath: string | undefined;

  /** A change of `status` to `path`, from `previousPath` for a rename or a copy. */
  constructor(path: string, status: DiffedFile["status"], previousPath?: string) {
    this.path = path;
    this.status = status;
    this.previousPath = previousPath;
  }

  /** Every change `git diff --name-status -z` listed, in its order. */
  static listedIn(result: GitResult): Change[] {
    // Each entry is a status letter (with a score after R or C), then the path,
    // or for a rename or a copy where it came from and where it went.
    const fields = result.paths();
    // Any letter not here is a modification.
    const statuses: Record<string, DiffedFile["status"]> = {
      A: "added",
      D: "deleted",
      R: "renamed",
      C: "copied",
    };
    const changes: Change[] = [];
    let index = 0;
    while (index < fields.length) {
      const status = statuses[(fields[index++] ?? "").charAt(0)] ?? "modified";
      const first = fields[index++] ?? "";
      if (status === "renamed" || status === "copied") {
        changes.push(new Change(fields[index++] ?? "", status, first));
      } else {
        changes.push(new Change(first, status));
      }
    }
    return changes;
  }

  /** This change with whatever `except` matches left out: a rename to or from such a file keeps only its other end. */
  without(except: PathFilter): Change | null {
    const keepsPath = !except(this.path);
    const keepsPrevious = this.previousPath !== undefined && !except(this.previousPath);
    if (this.previousPath === undefined && keepsPath) {
      return this;
    }
    if (this.previousPath === undefined) {
      return null;
    }
    if (keepsPath && keepsPrevious) {
      return this;
    }
    if (keepsPrevious) {
      return new Change(this.previousPath, "deleted");
    }
    if (keepsPath) {
      return new Change(this.path, "added");
    }
    return null;
  }

  /** The paths a diff of this change covers: both ends of a rename or a copy. */
  paths(): string[] {
    if (this.previousPath === undefined) {
      return [this.path];
    }
    return [this.previousPath, this.path];
  }

  /** This change, as a diff reports it, with `patch` as its part of the diff. */
  diffedWith(patch: string): DiffedFile {
    if (this.previousPath === undefined) {
      return { path: this.path, status: this.status, patch };
    }
    return { path: this.path, status: this.status, previous_path: this.previousPath, patch };
  }
}
