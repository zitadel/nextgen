import { access, readdir, readFile, stat } from "node:fs/promises";

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
 * Reads a UTF-8 text file, treating a file that does not exist as "no text"
 * rather than as an error.
 *
 * It spares every optional-file read a hand-written
 * `try { await readFile(...) } catch` to recognise `ENOENT`. Only a missing file
 * gives `undefined`. A file that exists but cannot be read, such as one without
 * read permission or a directory, still throws, so it is not mistaken for an
 * absent one.
 *
 * @param path The file to read.
 * @returns The file's contents, or `undefined` when it does not exist.
 * @throws Any error from reading the file other than it not existing.
 *
 * @example
 * const text = await readIfExists(join(cwd, ".env"));
 * if (text === undefined) {
 *   return {};
 * }
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
 * Lists the names in a directory, treating a directory that does not exist as an
 * empty one.
 *
 * Some directories the CLI lists may not exist yet, such as the directory
 * `setup` is about to scaffold an app into, so "no such folder" and "no files in
 * the folder" mean the same thing to the caller. Only a missing directory
 * (`ENOENT`) is treated that way. A directory
 * that exists but cannot be listed, such as one without read permission, or a
 * file where a directory should be (`ENOTDIR`), still throws, so a broken layout
 * is reported and not mistaken for an empty folder.
 *
 * The names are returned as `readdir` gives them: file and folder names only,
 * not full paths, in no guaranteed order. Sort them if the order matters.
 *
 * @param path The directory to list.
 * @returns The entry names, or `[]` when the directory does not exist.
 * @throws Any error from reading the directory other than it not existing.
 */
export async function readDirIfExists(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return [];
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

/**
 * Whether `path` is a regular file.
 *
 * Answers `false` for anything else: a directory, a socket, a path that does
 * not exist, or a path that cannot be looked at (for example because of
 * permissions). This is the lenient check, for "is there a file here I can use"
 * decisions where every kind of no is the same no. Use {@link pathExistsStrict}
 * when a path that cannot be inspected should be an error and not a "no".
 *
 * Symbolic links are followed, so a link to a file counts as a file.
 *
 * @param path The path to check.
 * @returns `true` when the path leads to a regular file.
 */
export async function isFile(path: string): Promise<boolean> {
  return stat(path).then(
    (info) => info.isFile(),
    () => false,
  );
}
