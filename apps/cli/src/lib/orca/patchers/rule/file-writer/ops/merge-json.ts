import { deepMerge, parseJsonObject, stableStringify } from "@/lib/json";
import {
  type Change,
  Operation,
  type Source,
} from "@/lib/orca/patchers/rule/file-writer/operation";

/**
 * Lays a patch over a JSON file, merging objects found at the same key and
 * replacing everything else.
 */
export class MergeJsonOp extends Operation<"merge-json"> {
  /**
   * @returns The JSON file to patch.
   */
  protected target(): ReadonlyArray<string> {
    return [this.op.path];
  }

  /**
   * @returns The file with the patch laid over it.
   */
  protected change(source: Source): Change {
    const document = source.before ? parseJsonObject(source.before, source.path) : {};
    const merged = deepMerge(document, this.op.patch);

    return this.file(source, `${stableStringify(merged)}\n`);
  }
}
