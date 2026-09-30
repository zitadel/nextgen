/**
 * Exit non-zero if any file passed as an argument does not exist.
 *
 * A cross-platform replacement for `test -f` in moon/npm task scripts: the POSIX
 * `test` utility is unavailable in non-bash Windows shells. Used to fail loud
 * when an explicitly named test file is renamed or moved — Vitest treats a
 * positional filter that matches nothing as a pass (passWithNoTests), so a task
 * that enumerates its test files would otherwise keep passing on the survivors.
 */
import { existsSync } from "node:fs";

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error("assert-file: no paths given");
  process.exit(1);
}
const missing = paths.filter((p) => !existsSync(p));
if (missing.length > 0) {
  console.error(`assert-file: required file(s) not found: ${missing.join(", ")}`);
  process.exit(1);
}
