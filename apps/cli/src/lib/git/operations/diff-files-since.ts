import { Change } from "../change";
import { CommitIsHere } from "../checks/commit-is-here";
import type { Git } from "../git";
import type { Check, Operation } from "../operation";
import { StagingArea } from "../staging-area";
import type { DiffedFile, PathFilter } from "../types";

/** Options every diff carries: git's own diff, never an external program's, with paths from the directory. */
const DIFF_SETTINGS = ["--no-ext-diff", "--relative"];

/** The changed files under `paths` since `commit`, untracked files as added, each with its part of the diff. */
export class DiffFilesSince implements Operation<DiffedFile[] | null> {
  private readonly commit: string;
  private readonly paths: readonly string[];
  private readonly except: PathFilter;
  private readonly format: readonly string[];

  /** Diffs `paths` since `commit` in `format`, leaving out every file `except` matches. */
  constructor(
    commit: string,
    paths: readonly string[],
    except: PathFilter,
    format: readonly string[],
  ) {
    this.commit = commit;
    this.paths = paths;
    this.except = except;
    this.format = format;
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
    // Each file is diffed on its own, so an excluded one is never diffed and
    // its content never reaches the output.
    const listed = await git.run([
      "diff",
      ...DIFF_SETTINGS,
      "--name-status",
      "-z",
      this.commit,
      "--",
      ...this.paths,
    ]);
    const changes = Change.listedIn(listed).flatMap((change) => change.without(this.except) ?? []);
    return Promise.all(
      changes.map(async (change) => {
        const diff = [
          "diff",
          ...DIFF_SETTINGS,
          ...this.format,
          this.commit,
          "--",
          ...change.paths(),
        ];
        return change.diffedWith((await git.run(diff)).stdout);
      }),
    );
  }
}
