/**
 * Exit non-zero if the file passed as the first argument does not exist.
 *
 * A cross-platform replacement for `test -f` in moon task scripts: the POSIX
 * `test` utility is unavailable in non-bash Windows shells. Used to fail loud
 * when a check task's test file is renamed or moved — Vitest treats a positional
 * filter that matches nothing as a pass (passWithNoTests), so without this guard
 * the check would silently stop running.
 */
import { existsSync } from "node:fs";

const path = process.argv[2];
if (!path || !existsSync(path)) {
  console.error(`assert-file: required file not found: ${path ?? "(no path given)"}`);
  process.exit(1);
}
