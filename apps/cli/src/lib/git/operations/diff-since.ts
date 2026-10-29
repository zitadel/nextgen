import { CommitIsHere } from "../checks/commit-is-here";
import type { Git } from "../git";
import type { Check, Operation } from "../operation";
import type { ColoredDiffOptions } from "../types";
import { DiffFilesSince } from "./diff-files-since";

/** The diff of `paths` since `commit`, untracked files as added, as one text for a terminal. */
export class DiffSince implements Operation<string | null> {
  private readonly commit: string;
  private readonly files: DiffFilesSince;

  /** Diffs `paths` since `commit`, as `options` say. */
  constructor(commit: string, paths: readonly string[], options: ColoredDiffOptions) {
    this.commit = commit;
    if (options.color) {
      this.files = new DiffFilesSince(commit, paths, options.except, ["--color=always"]);
    } else {
      this.files = new DiffFilesSince(commit, paths, options.except, ["--no-color"]);
    }
  }

  /** The commit is in local history. */
  checks(): Check[] {
    return [new CommitIsHere(this.commit)];
  }

  /** No diff: there is nothing to diff against. */
  refused(): string | null {
    return null;
  }

  /** Each changed file's patch, joined. */
  async run(git: Git): Promise<string> {
    const files = await this.files.run(git);
    return files.map((file) => file.patch).join("");
  }
}
