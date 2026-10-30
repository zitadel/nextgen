import { AuthorIdentity } from "../author-identity";
import { HeadIsOnABranch } from "../checks/head-is-on-a-branch";
import { NoOperationUnderWay } from "../checks/no-operation-under-way";
import { NothingExcludedIsStaged } from "../checks/nothing-excluded-is-staged";
import { SomethingIsStaged } from "../checks/something-is-staged";
import { RepositoryError } from "../errors";
import type { Git } from "../git";
import type { Check, Operation } from "../operation";
import { StagingArea } from "../staging-area";
import type { CommitOptions, CommitOutcome } from "../types";
import { CurrentCommit } from "./current-commit";

/**
 * Commits everything under the directory but `options.except`.
 *
 * The commit is built in a temporary staging area that starts from the last
 * commit, never in the developer's own: theirs may hold another package's
 * staged work, which would be swept in. A pathspec is no way round that,
 * since `git commit -- .` commits the working tree and ignores the staging
 * area, so an excluded file that is already tracked would go in anyway.
 *
 * Expects nothing uncommitted of the developer's under the directory: once
 * committed, their staging area there is reset to the new commit, or they
 * would see the commit's files staged for deletion.
 */
export class CommitAll implements Operation<CommitOutcome> {
  private readonly message: string;
  private readonly options: CommitOptions;

  /** Commits with `message`, as `options` say. */
  constructor(message: string, options: CommitOptions) {
    this.message = message;
    this.options = options;
  }

  /**
   * Nothing is under way that the commit would land in the middle of.
   *
   * Mid-merge, a commit would record a merge with the wrong parents; mid-rebase
   * or on a detached HEAD, it would sit on no branch and be lost.
   */
  checks(): Check[] {
    return [new NoOperationUnderWay(), new HeadIsOnABranch()];
  }

  /** Nothing committed, for `problem`. */
  refused(problem: string): CommitOutcome {
    return { committed: false, reason: problem };
  }

  /**
   * Stages everything, takes the excluded files back out, checks, and commits.
   *
   * What is about to be committed is checked rather than trusted: a file
   * committed once cannot be taken out of history, and `reset` reports
   * success for a path it did not match. The reset of the developer's staging
   * area afterwards is best effort, since the commit has already landed.
   */
  async run(git: Git): Promise<CommitOutcome> {
    const author = await AuthorIdentity.of(git, this.options.authorIfGitHasNone);
    return StagingArea.temporary(git, async (staging) => {
      await staging.startFromHead();
      await staging.addAll();
      await staging.unstage(this.options.except);
      const problem = await staging.problem([
        new NothingExcludedIsStaged(this.options.except),
        new SomethingIsStaged(),
      ]);
      if (problem !== null) {
        return this.refused(problem);
      }
      await staging.commit(this.message, author.environment());
      const sha = await new CurrentCommit().run(git);
      if (sha === null) {
        throw new RepositoryError("the commit left no HEAD to record");
      }
      await git.run(["reset", "--quiet", "--", "."]).catch(() => undefined);
      return { committed: true, sha, author: author.source };
    });
  }
}
