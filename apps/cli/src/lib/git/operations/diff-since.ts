import { CommitIsHere } from "../checks/commit-is-here";
import type { Git } from "../git";
import type { Check, Operation } from "../operation";
import { StagingArea } from "../staging-area";
import type { DiffOptions } from "../types";

/** The diff of `paths` since `commit`, untracked files as added, as git prints it. */
export class DiffSince implements Operation<string | null> {
  private readonly commit: string;
  private readonly paths: readonly string[];
  private readonly format: readonly string[];

  /** Diffs `paths` since `commit`, coloured as `options` say, with `extra` added to git's format. */
  constructor(
    commit: string,
    paths: readonly string[],
    options: DiffOptions,
    extra: readonly string[] = [],
  ) {
    this.commit = commit;
    this.paths = paths;
    if (options.color) {
      this.format = ["--color=always", ...extra];
    } else {
      this.format = ["--no-color", ...extra];
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

  /** Diffs in a copy of the developer's staging area with untracked files marked as added; plainly if that fails. */
  async run(git: Git): Promise<string> {
    const diff = [
      "diff",
      "--no-ext-diff",
      "--relative",
      ...this.format,
      this.commit,
      "--",
      ...this.paths,
    ];
    try {
      return await StagingArea.temporary(git, async (staging) => {
        await staging.startFromDevelopers(git);
        await staging.markAsAdded(this.paths);
        return (await staging.git.run(diff)).stdout;
      });
    } catch {
      return (await git.run(diff)).stdout;
    }
  }
}
