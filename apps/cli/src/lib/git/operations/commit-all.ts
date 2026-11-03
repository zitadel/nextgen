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
 * staged work, which would be swept in. It carries the developer's per-file
 * flags, so a file they told git to leave alone stays out of the commit. A pathspec is no way round that,
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
   * Stages everything but the excluded files, checks, and commits.
   *
   * The caller's fallback author is named only where git cannot build an
   * identity at all; a commit with no author would leave nothing to diff a
   * later deploy against.
   *
   * What is about to be committed is checked rather than trusted, since a
   * file committed once cannot be taken out of history. The reset of the
   * developer's staging area afterwards is best effort, since the commit has
   * already landed.
   *
   * A commit can land and git still fail afterwards: a post-commit hook that
   * errors, or one that runs past the five-minute limit. So when the commit
   * fails, HEAD is read again, and a HEAD that moved means the commit was made
   * and is reported as made.
   */
  async run(git: Git): Promise<CommitOutcome> {
    const identity = await AuthorIdentity.of(git);
    const before = await new CurrentCommit().run(git);
    return StagingArea.temporary(git, async (staging) => {
      await staging.startFromHead(git);
      await staging.addAll(this.options.except);
      const problem = await staging.problem([
        new NothingExcludedIsStaged(this.options.except),
        new SomethingIsStaged(),
      ]);
      if (problem !== null) {
        return this.refused(problem);
      }
      try {
        if (identity.source === "fallback") {
          await staging.commit(this.message, this.options.authorIfGitHasNone);
        } else {
          await staging.commit(this.message, null);
        }
      } catch (error) {
        if ((await new CurrentCommit().run(git)) === before) {
          throw error;
        }
      }
      const sha = await new CurrentCommit().run(git);
      if (sha === null) {
        throw new RepositoryError("the commit left no HEAD to record");
      }
      await git.run(["reset", "--quiet", "--", "."]).catch(() => undefined);
      return { committed: true, sha, author: identity.source };
    });
  }
}
