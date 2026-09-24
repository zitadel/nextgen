import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Whether a caught error is the given `errno` code. */
function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/** Env file holding real values. Never committed. */
export const ENV_LOCAL = ".env.local";
/** Env file holding the names only, committed so a teammate knows what to set. */
export const ENV_EXAMPLE = ".env.example";

/**
 * Whether a secret may be written to `relPath` in this Project.
 *
 * Two questions, because they have different answers:
 *
 * - **Outside a repository** nothing can be committed, so there is nothing to
 *   leak. `zitadel setup` scaffolds `.gitignore` with `.env*` but does not run
 *   `git init`, so this is the state a fresh project is in, and refusing there
 *   would block the common first run for no gain.
 * - **Inside a repository** only git can answer. Ignore rules compose from
 *   `.gitignore` files at every level, `.git/info/exclude` and the global
 *   excludes file, so reading `.gitignore` would agree with git only by
 *   coincidence. The index is deliberately consulted (no `--no-index`): a
 *   file that is already tracked is not ignored whatever the patterns say,
 *   and committing to it would publish the secret.
 *
 * Inside a repository, anything other than a clear "ignored" is a refusal.
 */
export async function isSafeForSecrets(cwd: string, relPath: string): Promise<boolean> {
  try {
    await exec("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
  } catch {
    // No repository, or no git at all: nothing here can be committed.
    return true;
  }
  try {
    // Exit 0 means ignored; anything else means it is not, or that we could
    // not tell — both answer "do not write a secret here".
    await exec("git", ["check-ignore", "--quiet", relPath], { cwd });
    return true;
  } catch {
    return false;
  }
}

/** One `NAME=value` line, with `value` omitted for an example file. */
export type EnvEntry = { readonly name: string; readonly value?: string };

/**
 * Add `entries` to an env file, keeping what is already there.
 *
 * A name already present is left exactly as it stands, value and all. The
 * developer's own value always wins: overwriting one would silently replace a
 * working credential, and this runs on a Project that may already be
 * configured.
 *
 * Returns the names actually added, so the caller can tell the developer what
 * changed without re-reading the file.
 */
export async function mergeEnvFile(
  cwd: string,
  relPath: string,
  entries: readonly EnvEntry[],
): Promise<string[]> {
  const path = join(cwd, relPath);
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if (!isErrno(error, "ENOENT")) {
      throw error;
    }
  }
  const present = new Set(
    existing
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => line.slice(0, line.indexOf("=")).trim())
      .filter((name) => name !== ""),
  );
  const added = entries.filter((entry) => !present.has(entry.name));
  if (added.length === 0) {
    return [];
  }
  const lines = added.map((entry) => `${entry.name}=${entry.value ?? ""}`);
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  await writeFile(path, `${existing}${separator}${lines.join("\n")}\n`, "utf8");
  return added.map((entry) => entry.name);
}

/** What happened to a captured secret, for the command's summary. */
export type SecretOutcome =
  | { readonly stored: true; readonly name: string }
  /**
   * Not written. Either the developer gave no value, the file cannot be
   * written to safely, or the name already had one — `mergeEnvFile` never
   * overwrites, so reporting "stored" there would be a lie the developer
   * only discovers when sign-in keeps failing with the old credential.
   */
  | {
      readonly stored: false;
      readonly name: string;
      readonly reason: "deferred" | "not-ignored" | "already-set";
    };

/**
 * Store a client secret for local development.
 *
 * The name is always added to `.env.example` without its value, so the
 * variable is discoverable in a fresh clone. The value is written only to
 * `.env.local`, and only where that cannot be committed — writing a
 * credential into a tracked file is the one failure this whole path exists to
 * prevent, and a later `git add -A` would publish it.
 *
 * Passing no value stores nothing and is not an error: the developer may
 * intend to paste it into `.env.local` themselves.
 */
export async function storeClientSecret(options: {
  readonly cwd: string;
  readonly name: string;
  readonly value?: string;
}): Promise<SecretOutcome> {
  const { cwd, name, value } = options;
  await mergeEnvFile(cwd, ENV_EXAMPLE, [{ name }]);
  if (value === undefined || value === "") {
    return { stored: false, name, reason: "deferred" };
  }
  if (!(await isSafeForSecrets(cwd, ENV_LOCAL))) {
    return { stored: false, name, reason: "not-ignored" };
  }
  const added = await mergeEnvFile(cwd, ENV_LOCAL, [{ name, value }]);
  if (added.length === 0) {
    return { stored: false, name, reason: "already-set" };
  }
  return { stored: true, name };
}
