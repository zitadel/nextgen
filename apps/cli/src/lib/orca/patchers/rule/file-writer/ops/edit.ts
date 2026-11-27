import {
  type Change,
  Operation,
  type Source,
} from "@/lib/orca/patchers/rule/file-writer/operation";

/**
 * Runs a patcher's edit on a file.
 *
 * The edit runs on the first candidate path that exists, or on the first
 * candidate when none does, which is where the file is then created. An
 * existing file keeps its permission bits across the temp-file swap.
 */
export class EditOp extends Operation<"edit"> {
  /**
   * @returns The candidate paths for the file, the preferred one first.
   */
  protected target(): ReadonlyArray<string> {
    return [this.op.path].flat();
  }

  /**
   * @returns The file as the edit leaves it, written atomically with its own mode.
   */
  protected change(source: Source): Change {
    return this.file(source, this.op.edit(source.before), {
      mode: source.entry?.mode,
      atomic: true,
    });
  }
}
