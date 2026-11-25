import type { Git } from "@/lib/git/git";
import type { Check, Operation } from "@/lib/git/operation";

/**
 * Whether anything in the whole repository is uncommitted, not only under the directory.
 *
 * Any change anywhere in the repository counts, including outside the
 * directory the repository was opened on.
 */
export class IsDirty implements Operation<boolean> {
  /** Nothing to check. */
  checks(): Check[] {
    return [];
  }

  /** Never refused. */
  refused(): boolean {
    return false;
  }

  /** Asks git whether `status` lists anything. */
  async run(git: Git): Promise<boolean> {
    const result = await git.run(["status", "--porcelain"]);
    return result.stdout.trim() !== "";
  }
}
