import { ZitadelError } from "@/lib/errors";
import {
  type Change,
  Operation,
  type Source,
} from "@/lib/orca/patchers/rule/file-writer/operation";

/**
 * Writes a file whole.
 *
 * A file that already holds something else is the user's, so it is replaced
 * only when `force` is set. The write goes through a temporary file, so a reader
 * never sees half of it.
 */
export class WriteOp extends Operation<"write"> {
  /**
   * @returns The file to write.
   */
  protected target(): ReadonlyArray<string> {
    return [this.op.path];
  }

  /**
   * @returns The file as the op wants it, written atomically.
   * @throws `E_CONFLICT` when the file holds something else and `force` is not set.
   */
  protected change(source: Source): Change {
    const isConflict =
      source.before !== undefined && source.before !== this.op.contents && !source.force;

    if (isConflict) {
      throw new ZitadelError("E_CONFLICT", `Refusing to overwrite ${source.path}`, {
        hint: "Re-run with --force if you want the CLI to replace this file.",
        details: {
          path: source.path,
        },
      });
    }

    return this.file(source, this.op.contents, {
      mode: this.op.mode,
      atomic: true,
    });
  }
}
