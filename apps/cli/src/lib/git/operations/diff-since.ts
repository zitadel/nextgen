import { CommitIsHere } from "@/lib/git/checks/commit-is-here";
import { Git } from "@/lib/git/git";
import type { Check, Operation } from "@/lib/git/operation";
import { StagingArea } from "@/lib/git/staging-area";
import type { DiffOptions } from "@/lib/git/types";

/**
 * The diff of `paths` since `commit`, untracked files as added, as git prints it.
 *
 * One `git diff` over all of `paths`. Not one per file: a path matches
 * everything under it too, so a file replaced by a directory took in the
 * directory's files, and hundreds of files meant hundreds of processes, which
 * ran out of open files. Nothing is left out of the diff: the paths are the
 * caller's to choose, and whatever they or `options.globs` name, a secret
 * included, is shown, unless `options.excluded` leaves it out.
 */
export class DiffSince implements Operation<string | null> {
  private readonly commit: string;
  private readonly paths: readonly string[];
  private readonly globs: readonly string[];
  private readonly excluded: readonly string[];
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
    this.globs = options.globs ?? [];
    this.excluded = options.excluded ?? [];
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

  /**
   * Diffs in a copy of the developer's staging area with untracked files marked as added.
   *
   * `git diff` leaves untracked files out, but a new file is part of what a
   * deploy publishes, so it is marked "intent to add" first, in a copy and
   * never in the developer's own staging area. When that cannot be done the
   * plain diff is given instead, which still shows every tracked change.
   *
   * `--no-ext-diff` keeps a configured external diff tool out, `--relative`
   * names paths from the directory, and each path is taken literally
   * ({@link Git.literal}), so `app/[id].tsx` does not also diff `app/i.tsx`;
   * `globs` are taken as globs ({@link Git.glob}). An excluded file may still
   * be marked as added; the diff leaves it out.
   */
  async run(git: Git): Promise<string> {
    const diff = [
      "diff",
      "--no-ext-diff",
      "--relative",
      ...this.format,
      this.commit,
      "--",
      ...this.paths.map(Git.literal),
      ...this.globs.map(Git.glob),
      ...this.excluded.map(Git.excluded),
    ];
    return StagingArea.temporary(git, async (staging) => {
      try {
        await staging.startFromDevelopers(git);
        await staging.markAsAdded(this.paths, this.globs);
        return (await staging.git.run(diff)).stdout;
      } catch {
        return (await git.run(diff)).stdout;
      }
    });
  }
}
