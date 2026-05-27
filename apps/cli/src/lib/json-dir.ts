import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { ZitadelError } from "./errors";

/**
 * Options for {@link readJsonDir}. `requireDir: true` throws an
 * `E_VALIDATION` `ZitadelError` when the directory is missing, which
 * suits commands that want a clear "you forgot to run setup" error.
 * The default (`false`) treats a missing directory as an empty result
 * set.
 */
type ReadJsonDirOptions = {
  readonly requireDir?: boolean;
  /**
   * Message used when `requireDir: true` and the directory is missing.
   * Defaults to a generic phrasing referencing `absDir`.
   */
  readonly missingMessage?: string;
  /**
   * Optional `nextCommands` to attach to the `E_VALIDATION` error when
   * `requireDir: true` triggers. Lets callers steer users to the
   * matching `zitadel <verb>` next step.
   */
  readonly missingNextCommands?: ReadonlyArray<string>;
};

/**
 * Read every `*.json` file under `absDir` and return each body as a
 * plain object. Files are read in lexical filename order so the
 * result is deterministic for downstream hashing and diffs. Each
 * file is parsed by `JSON.parse`; this function does **not** apply
 * any schema validation — unknown keys, forward-compatible fields,
 * and `${VAR}` placeholders survive intact. Callers that need a
 * typed shape pass the result through their resource's Zod schema.
 *
 * Throws `E_VALIDATION` `ZitadelError` on invalid JSON or when a
 * file's root value is not a JSON object. Returns an empty array
 * when the directory itself is missing, unless `requireDir` is true.
 *
 * @param absDir - Absolute path to the directory to scan.
 * @param opts   - See {@link ReadJsonDirOptions}.
 */
export async function readJsonDir(
  absDir: string,
  opts: ReadJsonDirOptions = {},
): Promise<ReadonlyArray<Record<string, unknown>>> {
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) {
      if (opts.requireDir) {
        const message = opts.missingMessage ?? `Directory ${absDir} is missing.`;
        throw new ZitadelError("E_VALIDATION", message, {
          nextCommands: opts.missingNextCommands ? [...opts.missingNextCommands] : undefined,
        });
      }
      return [];
    }
    throw error;
  }
  const result: Record<string, unknown>[] = [];
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    const abs = join(absDir, entry);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(abs, "utf8"));
    } catch {
      throw new ZitadelError("E_VALIDATION", `${entry} is not valid JSON`);
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new ZitadelError("E_VALIDATION", `${entry} must contain a JSON object at the root`);
    }
    result.push(raw as Record<string, unknown>);
  }
  return result;
}

function isErrnoCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === code
  );
}
