import { chmod, readFile, writeFile } from "node:fs/promises";

import { ZitadelError } from "./errors";
import { reportWarning } from "./warnings";

/**
 * The single writer for a managed `.env.<name>.local` file.
 *
 * These files may hold a credential (`ZITADEL_PROJECT_SECRET`,
 * `ZITADEL_PREVIEW_TOKEN`), so the mode, the chmod-failure policy and the
 * line-break guard are decided here once rather than re-decided — or forgotten —
 * at each write site. Nothing else in the CLI should call `node:fs`
 * `writeFile`/`chmod` on one of these files; use {@link writeManagedEnvFile} to
 * (re)write a whole file and {@link appendManagedEnvValue} to add one value.
 */

/** A file that may carry a credential is owner read/write only. */
const SECRET_MODE = 0o600;

/**
 * One `key=value` per line is the whole file format, so a line break in a value
 * would inject a spurious line (or split a secret) that the next run reads back
 * as different keys. A break is never a legitimate credential, URL or id, so
 * refuse it rather than write a file we cannot read back faithfully.
 */
function envLine(key: string, value: string): string {
  if (/[\n\r]/.test(value)) {
    throw new ZitadelError(
      "E_VALIDATION",
      `Cannot persist ${key}: its value contains a line break.`,
      {
        hint: "A .env value is a single line; remove the newline or store the value another way.",
      },
    );
  }
  return `${key}=${value}`;
}

/**
 * `writeFile`'s `mode` applies only when it creates the file and is masked by
 * the umask, so re-assert the intended mode after every write. A filesystem that
 * cannot chmod (FAT/exFAT, some bind mounts) must not fail the write — the
 * content is already on disk and the next run would read it back without
 * re-prompting, so a throw would be one confusing failure followed by silent
 * success with the same file. Warn once that it could not be locked down, and
 * proceed. This is the only place the CLI calls `chmod` after a write: a bare
 * `chmod(...).catch(() => undefined)` hides the failure from the user and the
 * JSON envelope, and a lint rule (`no-swallowed-chmod`) rejects it.
 */
export async function enforceMode(path: string, mode: number): Promise<void> {
  try {
    await chmod(path, mode);
  } catch (error) {
    reportWarning(
      `Wrote ${path} but could not set it to ${mode.toString(8).padStart(4, "0")} (${(error as NodeJS.ErrnoException).code ?? "unknown"}); its permissions may be broader than intended.`,
    );
  }
}

function enforceSecretMode(path: string): Promise<void> {
  return enforceMode(path, SECRET_MODE);
}

/**
 * Write a managed env file from scratch, creating or overwriting it, held at
 * 0600. Every value is line-break checked before anything is written, so a bad
 * value fails the whole write rather than corrupting the file.
 */
export async function writeManagedEnvFile(
  path: string,
  values: Record<string, string>,
): Promise<void> {
  const body = `${Object.entries(values)
    .map(([key, value]) => envLine(key, value))
    .join("\n")}\n`;
  await writeFile(path, body, { mode: SECRET_MODE });
  await enforceSecretMode(path);
}

/**
 * Append one `key=value` to a managed env file, creating it if absent. Newline-
 * safe so a file without a trailing newline is not concatenated onto its last
 * line.
 */
export async function appendManagedEnvValue(
  path: string,
  key: string,
  value: string,
): Promise<void> {
  const line = envLine(key, value);
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const next = `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${line}\n`;
  await writeFile(path, next, { mode: SECRET_MODE });
  await enforceSecretMode(path);
}
