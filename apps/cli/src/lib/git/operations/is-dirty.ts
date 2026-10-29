import type { Git } from "../git";
import type { Check, Operation } from "../operation";

/** Whether anything in the whole repository is uncommitted, not only under the directory. */
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
    return result.text().trim() !== "";
  }
}
