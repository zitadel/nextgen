/**
 * Whether `path` must never be committed: a `.zitadel/secret`, anything under `.zitadel/local/`, or an `.env*` file other than `.env.example`.
 *
 * Matched without regard to case, since `.ENV` is the same file as `.env` on
 * macOS and Windows.
 */
export function isSecretPath(path: string): boolean {
  const lower = path.toLowerCase();
  const name = lower.split("/").pop() ?? lower;
  if (lower === ".zitadel/secret" || lower.endsWith("/.zitadel/secret")) {
    return true;
  }
  if (isLocalRuntimePath(lower)) {
    return true;
  }
  return name.startsWith(".env") && name !== ".env.example";
}

/**
 * Whether `path` is under `.zitadel/local/`, at any depth, where the local server keeps its admin credential and data.
 *
 * Matched with its case, since it names the directory `start` writes; on a
 * case-sensitive filesystem `.Zitadel/Local/` is someone else's.
 */
export function isLocalRuntimePath(path: string): boolean {
  return /(^|\/)\.zitadel\/local(\/|$)/.test(path);
}

/**
 * The file an environment's project id and secrets live in: `.env.<name>.local`,
 * which `env add` writes and a prompt's answer is saved to.
 *
 * @param name - The environment, as {@link import("./environment").isEnvironmentName} allows it.
 * @returns The file's name, in the project's root.
 */
export function environmentFileName(name: string): string {
  return `.env.${name}.local`;
}

/**
 * What `eject` renames an env file to, keeping the secrets it holds beside the
 * app rather than deleting them.
 *
 * @param path - The env file.
 * @param stamp - When it was ejected, as a name can hold it.
 * @returns The backup's path.
 */
export function ejectedBackup(path: string, stamp: string): string {
  return `${path}.ejected-${stamp}`;
}
