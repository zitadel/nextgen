import { Change } from "../change";
import type { Git } from "../git";
import type { Check, Operation } from "../operation";
import type { DiffedFile } from "../types";
import { DiffSince } from "./diff-since";

/** The changed files under `paths` since `commit`, untracked files as added, each with its part of the diff. */
export class DiffFilesSince implements Operation<DiffedFile[] | null> {
  private readonly diff: DiffSince;

  /** Diffs `paths` since `commit`, uncoloured, with the list of changed files ahead of the patch. */
  constructor(commit: string, paths: readonly string[]) {
    this.diff = new DiffSince(commit, paths, {}, ["--raw", "-z", "--patch"]);
  }

  /** Those of the diff. */
  checks(): Check[] {
    return this.diff.checks();
  }

  /** No diff: there is nothing to diff against. */
  refused(): DiffedFile[] | null {
    return null;
  }

  /** Each listed file paired with its section of the patch: git writes both from one list, in one order. */
  async run(git: Git): Promise<DiffedFile[]> {
    const output = await this.diff.run(git);
    // One more NUL ends the list; the patch follows.
    const end = output.indexOf("\0\0");
    if (end === -1) {
      return [];
    }
    const changes = Change.listedIn(output.slice(0, end).split("\0"));
    const sections = output.slice(end + 2).split(/^(?=diff --git )/m);
    const files: DiffedFile[] = [];
    let next = 0;
    for (const change of changes) {
      let patch = sections[next++] ?? "";
      // A file whose type changed (a file replaced by a symlink) has two sections under one header.
      const header = patch.split("\n")[0];
      while (next < sections.length && sections[next]?.split("\n")[0] === header) {
        patch += sections[next++];
      }
      files.push(change.diffedWith(patch));
    }
    return files;
  }
}
