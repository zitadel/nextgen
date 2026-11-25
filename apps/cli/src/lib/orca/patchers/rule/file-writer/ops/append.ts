import {
  type Change,
  Operation,
  type Source,
} from "@/lib/orca/patchers/rule/file-writer/operation";

/**
 * Adds contents at the end of a file, unless the file already holds the op's
 * marker.
 */
export class AppendOp extends Operation<"append"> {
  /**
   * @returns The file to add to.
   */
  protected target(): ReadonlyArray<string> {
    return [this.op.path];
  }

  /**
   * @returns The file with the contents added, or as it is when it holds the marker.
   */
  protected change(source: Source): Change {
    const marker = this.op.ifMissing ?? "";
    const isPresent = marker !== "" && source.text.includes(marker);

    if (isPresent) {
      return this.file(source, source.text);
    }

    return this.file(source, this.joined(source.text, this.op.contents));
  }
}
