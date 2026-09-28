import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { consola } from "consola";

import { publicCliCommand } from "../public-cli";

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

/**
 * Publishes one secret variable to the project.
 *
 * Injected rather than built here: this module knows about files and git, and
 * giving it an API client as well would make the one place that decides where
 * a credential may be written depend on the whole platform surface. Both
 * callers already hold a connection to the project they just addressed.
 */
export type SecretPublisher = (name: string, value: string) => Promise<void>;

/** Where a captured client secret ended up, for the command's summary. */
export type SecretOutcome = {
  readonly name: string;

  /**
   * The project's variables — the destination that decides whether the
   * provider button works. The connection document references the credential
   * as `${{ NAME }}`, and the engine resolves that from the project's
   * variables and from nowhere else, so a local server and Zitadel Cloud both
   * need the value here.
   *
   * `deferred` when there was no value to publish or no project to publish to;
   * `failed` when the platform refused the call. Neither is fatal — the
   * connection is written either way and `variables set` publishes it later.
   */
  readonly published: "stored" | "deferred" | "failed";

  /**
   * `.env.local`, where the value is mirrored so the developer keeps a copy of
   * what was published: a secret variable can be replaced but never read back
   * (ADR 062 §7). Nothing reads this file at runtime — the token exchange
   * happens on the server, not in the app.
   *
   * `not-ignored` when git would commit the file, `already-set` when the name
   * already had a value, because `mergeEnvFile` never overwrites one.
   */
  readonly mirrored: "stored" | "deferred" | "not-ignored" | "already-set";
};

/**
 * Capture a client secret: publish it to the project, and keep a local copy.
 *
 * The name is always added to `.env.example` without its value, so the
 * variable is discoverable in a fresh clone.
 *
 * Passing no value stores nothing and is not an error: the developer may
 * intend to publish it themselves.
 */
export async function storeClientSecret(options: {
  readonly cwd: string;
  readonly name: string;
  readonly value?: string;
  readonly publish?: SecretPublisher;
}): Promise<SecretOutcome> {
  const { cwd, name, value, publish } = options;
  await mergeEnvFile(cwd, ENV_EXAMPLE, [{ name }]);
  if (value === undefined || value === "") {
    return { name, published: "deferred", mirrored: "deferred" };
  }
  return {
    name,
    published: await publishSecret(publish, name, value),
    mirrored: await mirrorSecret(cwd, name, value),
  };
}

/**
 * Send the value to the project, reporting a refusal instead of raising it.
 *
 * By the time this runs the connection document is already on disk and, in
 * `setup`, the whole project is provisioned. Failing the command there would
 * leave the developer with a half-written Project to clean up over something
 * one later command fixes, so the caller warns and points at `variables set`.
 */
async function publishSecret(
  publish: SecretPublisher | undefined,
  name: string,
  value: string,
): Promise<SecretOutcome["published"]> {
  if (publish === undefined) {
    return "deferred";
  }
  try {
    await publish(name, value);
    return "stored";
  } catch (error) {
    consola.debug(`Publishing ${name} to the project failed`, error);
    return "failed";
  }
}

/**
 * Keep a copy in `.env.local`, and only where that cannot be committed:
 * writing a credential into a tracked file is the one failure this path
 * exists to prevent, and a later `git add -A` would publish it.
 */
async function mirrorSecret(
  cwd: string,
  name: string,
  value: string,
): Promise<SecretOutcome["mirrored"]> {
  if (!(await isSafeForSecrets(cwd, ENV_LOCAL))) {
    return "not-ignored";
  }
  const added = await mergeEnvFile(cwd, ENV_LOCAL, [{ name, value }]);
  return added.length === 0 ? "already-set" : "stored";
}

/**
 * Tell the developer what became of the secret, loudest where it matters.
 *
 * The project is the destination that makes sign-in work, so anything short of
 * a publish is a warning carrying the command that fixes it. The local mirror
 * follows as a detail: no runtime reads `.env.local`, the token exchange
 * happens on the server.
 */
export function reportSecretOutcome(outcome: SecretOutcome, cliVersion: string): void {
  const { name } = outcome;
  const republish = publicCliCommand(`variables set ${name} --secret`, cliVersion);
  switch (outcome.published) {
    case "stored":
      consola.success(`Published ${name} to the project`);
      break;
    case "deferred":
      // No value and no project reach the same place by different routes, and
      // the developer's next move differs, so they are worded apart. Only a
      // run with nothing to publish leaves the mirror deferred as well.
      consola.warn(
        outcome.mirrored === "deferred"
          ? `${name} has no value yet. Publish it with: ${republish}`
          : `${name} was not published to the project. Publish it with: ${republish}`,
      );
      break;
    case "failed":
      consola.warn(
        `${name} could not be published. Sign-in fails until it is: ${republish}`,
      );
      break;
  }
  switch (outcome.mirrored) {
    case "stored":
      consola.info(`Kept a copy in ${ENV_LOCAL}`);
      break;
    case "already-set":
      consola.info(`${ENV_LOCAL} already holds ${name} and was left alone`);
      break;
    case "not-ignored":
      consola.warn(`No copy kept in ${ENV_LOCAL}: git does not ignore that file`);
      break;
    case "deferred":
      break;
  }
}
