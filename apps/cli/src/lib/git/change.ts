import type { DiffedFile } from "./types";

/** One changed file, as `git diff --raw -z` lists it. */
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

  /** Every change in the NUL-separated `fields` of a `--raw -z` list, in its order. */
  static listedIn(fields: readonly string[]): Change[] {
    // Each entry is `:<modes> <ids> <letter>[<score>]`, then the path, or for a
    // rename or a copy where it came from and where it went.
    const statuses: Record<string, DiffedFile["status"]> = {
      A: "added",
      D: "deleted",
      R: "renamed",
      C: "copied",
    };
    const changes: Change[] = [];
    let index = 0;
    while (index < fields.length) {
      const entry = fields[index++] ?? "";
      // M, T (a type change) and U (unmerged) all count as modified.
      const status = statuses[entry.charAt(entry.lastIndexOf(" ") + 1)] ?? "modified";
      const first = fields[index++] ?? "";
      if (status === "renamed" || status === "copied") {
        changes.push(new Change(fields[index++] ?? "", status, first));
      } else {
        changes.push(new Change(first, status));
      }
    }
    return changes;
  }

  /** This change, as a diff reports it, with `patch` as its part of the diff. */
  diffedWith(patch: string): DiffedFile {
    if (this.previousPath === undefined) {
      return { path: this.path, status: this.status, patch };
    }
    return { path: this.path, status: this.status, previous_path: this.previousPath, patch };
  }
}
