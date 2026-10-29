import { Change } from "../change";
import { CommitIsHere } from "../checks/commit-is-here";
import type { Git } from "../git";
import type { Check, Operation } from "../operation";
import { StagingArea } from "../staging-area";
import type { ColoredDiffOptions, DiffedFile } from "../types";

/** The changed files under `paths` since `commit`, untracked files as added, each with its part of the diff. */
export class DiffFilesSince implements Operation<DiffedFile[] | null> {
  private readonly commit: string;
  private readonly paths: readonly string[];
  private readonly options: ColoredDiffOptions;

  /** Diffs `paths` since `commit`, as `options` say. */
  constructor(commit: string, paths: readonly string[], options: ColoredDiffOptions) {
    this.commit = commit;
    this.paths = paths;
    this.options = options;
  }

  /** The commit is in local history. */
  checks(): Check[] {
    return [new CommitIsHere(this.commit)];
  }

  /** No diff: there is nothing to diff against. */
  refused(): DiffedFile[] | null {
    return null;
  }

  /** Diffs in a copy of the developer's staging area with untracked files marked as added; plainly if that fails. */
  async run(git: Git): Promise<DiffedFile[]> {
    try {
      return await StagingArea.temporary(git, async (staging) => {
        await staging.startFromDevelopers(git);
        await staging.markAsAdded(this.paths);
        return this.files(staging.git);
      });
    } catch {
      return this.files(git);
    }
  }

  /** Each changed file `git` sees, with excluded files left out, and its patch. */
  private async files(git: Git): Promise<DiffedFile[]> {
    let color = "--no-color";
    if (this.options.color) {
      color = "--color=always";
    }
    const listed = await git.run([
      "diff",
      "--no-ext-diff",
      "--relative",
      "--name-status",
      "-z",
      this.commit,
      "--",
      ...this.paths,
    ]);
    const changes = Change.listedIn(listed).flatMap(
      (change) => change.without(this.options.except) ?? [],
    );
    // Each file is diffed on its own, so an excluded one is never diffed and its
    // content never reaches the output; a few at a time, so hundreds of changed
    // files do not run out of open files.
    const files: DiffedFile[] = [];
    for (let start = 0; start < changes.length; start += 16) {
      const batch = changes.slice(start, start + 16).map(async (change) => {
        const diff = [
          "diff",
          "--no-ext-diff",
          "--relative",
          color,
          this.commit,
          "--",
          ...change.paths(),
        ];
        return change.diffedWith((await git.run(diff)).stdout);
      });
      files.push(...(await Promise.all(batch)));
    }
    return files;
  }
}
