import type { Git } from "../git";
import type { Check, Operation } from "../operation";

/**
 * The commit the repository is at, or null before its first commit.
 *
 * A release records it as the commit it was built from. A repository with no
 * commit yet is an answer, null, not a failure.
 */
export class CurrentCommit implements Operation<string | null> {
  /** Nothing to check. */
  checks(): Check[] {
    return [];
  }

  /** Never refused. */
  refused(): string | null {
    return null;
  }

  /** Asks git for HEAD's commit. */
  async run(git: Git): Promise<string | null> {
    const result = await git.run(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], [1]);
    if (!result.succeeded()) {
      return null;
    }
    return result.text();
  }
}
