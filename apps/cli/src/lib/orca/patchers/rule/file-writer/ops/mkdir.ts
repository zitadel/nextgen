import {
  type Change,
  Operation,
  type Source,
} from "@/lib/orca/patchers/rule/file-writer/operation";

/**
 * Makes a directory.
 *
 * A directory that exists with other permissions than `mode` is repaired and
 * reported as an update, except on Windows, which has no POSIX permission
 * classes and would report a repair on every rerun.
 */
export class MkdirOp extends Operation<"mkdir"> {
  /**
   * @returns The directory to make.
   */
  protected target(): ReadonlyArray<string> {
    return [this.op.path];
  }

  /**
   * @returns Whether the directory exists, and whether its permissions drifted.
   */
  protected change(source: Source): Change {
    const isExisting = source.entry?.isDirectory ?? false;
    const isPosix = process.platform !== "win32";
    const isDrifted =
      isExisting && isPosix && this.op.mode !== undefined && source.entry?.mode !== this.op.mode;

    return this.dir(source, {
      mode: this.op.mode,
      isExisting,
      isDrifted,
    });
  }
}
