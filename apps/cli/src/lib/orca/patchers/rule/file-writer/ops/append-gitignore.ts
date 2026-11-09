import {
  type Change,
  Operation,
  type Source,
} from "@/lib/orca/patchers/rule/file-writer/operation";

/**
 * Adds the entries `.gitignore` does not hold yet, at the end.
 */
export class AppendGitignoreOp extends Operation<"append-gitignore"> {
  /**
   * @returns The `.gitignore` to add to.
   */
  protected target(): ReadonlyArray<string> {
    return [".gitignore"];
  }

  /**
   * @returns `.gitignore` with the missing entries added, or as it is when it holds them all.
   */
  protected change(source: Source): Change {
    const held = new Set(
      source.text.split(/\r?\n/g).map((line) => {
        return line.trim();
      }),
    );
    const missing = this.op.entries.filter((entry) => {
      return !held.has(entry);
    });

    if (missing.length === 0) {
      return this.file(source, source.text);
    }

    return this.file(source, this.joined(source.text, `${missing.join("\n")}\n`));
  }
}
