import { HeadIsOnABranch } from "../checks/head-is-on-a-branch";
import { NoOperationUnderWay } from "../checks/no-operation-under-way";
import type { Check, Operation } from "../operation";

/**
 * Why a commit here would land where it should not, or null when one would land on a branch as meant.
 *
 * The same checks {@link CommitAll} makes, asked on their own, so a caller
 * can refuse before it does any work rather than find out when it commits.
 */
export class ReadyToCommit implements Operation<string | null> {
  /** Nothing is under way, and HEAD is on a branch. */
  checks(): Check[] {
    return [new NoOperationUnderWay(), new HeadIsOnABranch()];
  }

  /** The first problem a check found. */
  refused(problem: string): string | null {
    return problem;
  }

  /** No problem: every check holds. */
  async run(): Promise<string | null> {
    return null;
  }
}
