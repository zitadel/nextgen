import {
  type Change,
  Operation,
  type Source,
} from "@/lib/orca/patchers/rule/file-writer/operation";
import { Project } from "@/lib/project";

/**
 * Appends the entries `.gitignore` needs for each rule's path to be ignored
 * or kept as the rule says, judged by what the file's lines do, not by
 * whether it holds the entry's text.
 */
export class AppendGitignoreOp extends Operation<"append-gitignore"> {
  /**
   * @returns The `.gitignore` to add to.
   */
  protected target(): ReadonlyArray<string> {
    return [".gitignore"];
  }

  /**
   * @returns `.gitignore` with the missing entries added, or as it is when every rule holds.
   */
  protected change(source: Source): Change {
    const missing = Project.gitignore(this.op.rules).entriesToAppend(source.text);

    if (missing.length === 0) {
      return this.file(source, source.text);
    }

    return this.file(source, this.joined(source.text, `${missing.join("\n")}\n`));
  }
}
