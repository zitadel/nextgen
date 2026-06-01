import { resolve } from "node:path";

/**
 * Resolve the working directory the CLI should operate against, defaulting to
 * the process CWD when no `--cwd` override is given. Always returns an
 * absolute path so downstream `join`/`readFile` calls are unaffected by later
 * `process.chdir` or relative-path ambiguity.
 */
export function resolveCwd(cwd?: string): string {
  return resolve(cwd ?? process.cwd());
}

/**
 * Sentinel comment stamped at the top of every file the CLI generates and
 * owns. Commands like `doctor` and `eject` look for this marker to decide
 * whether a file is safe to touch; the trailing `v1` lets the format evolve
 * without mistaking newer managed files for hand-edited ones.
 */
export const MANAGED_MARKER = "// zitadel-cli: managed-file v1";
