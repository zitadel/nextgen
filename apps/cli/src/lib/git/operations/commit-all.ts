import { AuthorIdentity } from "../author-identity";
import { RepositoryError } from "../errors";
import { HeadIsOnABranch } from "../checks/head-is-on-a-branch";
import { NoOperationUnderWay } from "../checks/no-operation-under-way";
import { NothingExcludedIsStaged } from "../checks/nothing-excluded-is-staged";
import { SomethingIsStaged } from "../checks/something-is-staged";
import type { Git } from "../git";
import type { Check, Operation } from "../operation";
import { StagingArea } from "../staging-area";
import type { CommitOptions, CommitOutcome } from "../types";
import { CurrentCommit } from "./current-commit";

/** Commits everything under the directory but `options.except`, leaving the developer's staged work alone. */
export class CommitAll implements Operation<CommitOutcome> {
  private readonly message: string;
  private readonly options: CommitOptions;

  /** Commits with `message`, as `options` say. */
  constructor(message: string, options: CommitOptions) {
    this.message = message;
    this.options = options;
  }

  /** Nothing is under way that the commit would land in the middle of. */
  checks(): Check[] {
    return [new NoOperationUnderWay(), new HeadIsOnABranch()];
  }

  /** Nothing committed, for `problem`. */
  refused(problem: string): CommitOutcome {
    return { committed: false, reason: problem };
  }

  /** Stages everything in a temporary staging area, takes the excluded files out, checks, and commits. */
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
      // Without this the developer would see the commit staged for deletion; best effort.
      await git.run(["reset", "--quiet", "--", "."]).catch(() => undefined);
      return { committed: true, sha, author: author.source };
    });
  }
}
