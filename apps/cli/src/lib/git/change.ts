import type { DiffedFile } from "./types";

/**
 * One changed file, as `git diff --raw -z` lists it: where it is, what
 * happened to it, and where it came from when it was renamed or copied.
 *
 * Read from git's raw list rather than from the patch's `diff --git` headers:
 * the list is NUL-separated and never quoted, while a header quotes a path
 * holding a space or a non-ASCII byte and cannot be split reliably.
 * {@link DiffFilesSince} pairs each change with its part of the patch.
 */
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

  /**
   * Every change in the NUL-separated `fields` of a `--raw -z` list, in its order.
   *
   * Each entry is `:<modes> <ids> <letter>[<score>]`, then the path, or for a
   * rename or a copy where it came from and where it went. The entries are
   * read in order rather than by looking for a `:`, since a path may start
   * with one. M, T (a type change) and U (unmerged) all count as modified.
   */
  static listedIn(fields: readonly string[]): Change[] {
    const statuses: Record<string, DiffedFile["status"]> = {
      A: "added",
      D: "deleted",
      R: "renamed",
      C: "copied",
    };
    const unread = fields.values();
    const changes: Change[] = [];
    for (const entry of unread) {
      const status = statuses[entry.charAt(entry.lastIndexOf(" ") + 1)] ?? "modified";
      const first = unread.next().value ?? "";
      if (status === "renamed" || status === "copied") {
        changes.push(new Change(unread.next().value ?? "", status, first));
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
