import { access, readFile } from "node:fs/promises";

import { isErrno } from "./errors";

/**
 * Whether anything exists at `path`. Any failure to look, not only a missing
 * path, reads as "no": use it to choose between two ways forward, not to
 * decide that a path is safe to touch.
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * A file's text, or `undefined` when it does not exist. A file that exists but
 * cannot be read (permissions, a directory) still throws, so it is not mistaken
 * for an absent one.
 */
export async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Whether anything exists at `path`, false only when it is missing. A path that
 * cannot be looked at for another reason (permissions, a file where a directory
 * should be) throws, so it is not mistaken for an absent one.
 */
export async function pathExistsStrict(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

/**
 * A file's text, or `undefined` when it is absent or cannot be read. For a
 * report on the state of files, where one that cannot be read is shown as
 * missing instead of aborting the rest.
 */
export function readIfReadable(path: string): Promise<string | undefined> {
  return readIfExists(path).catch(() => undefined);
}
