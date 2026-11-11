import { envLine } from "@/lib/fs-safe";
import {
  type Change,
  Operation,
  type Source,
} from "@/lib/orca/patchers/rule/file-writer/operation";

/**
 * Adds the entries an `.env` file does not hold yet.
 *
 * Where the file already holds one, the file's own value stands, unless
 * `overwrite` says this run's value outranks it. A secret-bearing file (`mode`
 * set) is brought back to its mode on every run, because `writeFile` applies a
 * mode only when it creates the file and the umask masks it.
 */
export class MergeEnvOp extends Operation<"merge-env"> {
  /**
   * @returns The `.env` file to add to.
   */
  protected target(): ReadonlyArray<string> {
    return [this.op.path];
  }

  /**
   * @returns The file with the missing entries added, or as it is when it holds them all.
   */
  protected change(source: Source): Change {
    const extras = {
      mode: this.op.mode,
      reassertMode: true,
    };
    const assignment = /^\s*([A-Za-z_][A-Za-z0-9_]*)=/;
    const existing = source.text
      .split("\n")
      .map((line) => {
        const name = assignment.exec(line)?.[1];
        const value =
          name !== undefined && Object.hasOwn(this.op.entries, name)
            ? this.op.entries[name]
            : undefined;
        const isOurs = this.op.overwrite && name !== undefined && value !== undefined;

        if (!isOurs) {
          return line;
        }

        return envLine(name, value);
      })
      .join("\n");
    const held = new Set(
      existing.split("\n").map((line) => {
        return assignment.exec(line)?.[1];
      }),
    );
    const missing = Object.entries(this.op.entries).filter(([name]) => {
      return !held.has(name);
    });
    const comment = (this.op.comment ?? []).map((line) => {
      return `# ${line}`;
    });
    const header = comment[0] !== undefined && !existing.includes(comment[0]) ? comment : [];
    const lines = missing.map(([name, value]) => {
      return envLine(name, value);
    });

    if (missing.length === 0) {
      return this.file(source, existing, extras);
    }

    return this.file(
      source,
      this.joined(existing, `${[...header, ...lines].join("\n")}\n`),
      extras,
    );
  }
}
