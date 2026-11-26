/**
 * The file-system calls of the CLI, throwing typed errors.
 *
 * @remarks
 * Every function here has the name of its `node:fs/promises` namesake and the
 * part of its signature the CLI uses. It calls Node and turns a failure of the
 * system call into the matching class of `./errors`, naming the operation and
 * the path and keeping Node's error as `cause`. Node's own argument errors
 * (`ERR_*`) are bugs in the caller and are rethrown as Node raised them.
 *
 * This is the one place that reads the `code` of a Node error. Everything else
 * imports file-system calls from here, never from `node:fs/promises`, and
 * catches {@link FsNotFoundError} and its siblings by class.
 */
import type {
  CopyOptions,
  Dirent,
  GlobOptionsWithoutFileTypes,
  MakeDirectoryOptions,
  Mode,
  PathLike,
  RmDirOptions,
  RmOptions,
  Stats,
  TimeLike,
  WriteFileOptions,
} from "node:fs";
import { unlinkSync as nodeUnlinkSync } from "node:fs";
import {
  mkdirSync as nodeMkdirSync,
  readFileSync as nodeReadFileSync,
  renameSync as nodeRenameSync,
  rmSync as nodeRmSync,
  writeFileSync as nodeWriteFileSync,
} from "node:fs";
import type { FileHandle } from "node:fs/promises";
import {
  access as nodeAccess,
  chmod as nodeChmod,
  copyFile as nodeCopyFile,
  cp as nodeCp,
  glob as nodeGlob,
  lstat as nodeLstat,
  mkdir as nodeMkdir,
  mkdtemp as nodeMkdtemp,
  open as nodeOpen,
  readdir as nodeReaddir,
  readFile as nodeReadFile,
  realpath as nodeRealpath,
  rename as nodeRename,
  rm as nodeRm,
  rmdir as nodeRmdir,
  stat as nodeStat,
  unlink as nodeUnlink,
  utimes as nodeUtimes,
  writeFile as nodeWriteFile,
} from "node:fs/promises";

import { isErrno } from "../errno";
import {
  FsDeniedError,
  FsError,
  FsExistsError,
  FsFailedError,
  FsIsDirectoryError,
  FsNotDirectoryError,
  FsNotFoundError,
} from "./errors";

export * from "./errors";

/**
 * The error to throw for a failure of a file-system call.
 *
 * @remarks
 * Every wrapper in this module uses it, and it is the only reader of a Node
 * error's `code` in the CLI. The config store uses it too, for the failures of
 * the file system it is given, so it recognises them by class.
 *
 * @param error - Whatever the Node call threw.
 * @param operation - What the call was doing, as a verb, for the message.
 * @param path - What it was doing it to.
 * @returns The typed error for a known code, {@link FsFailedError} for any other
 *   failure of the system call, otherwise `error` itself.
 */
export function fsFailure(error: unknown, operation: string, path: PathLike): unknown {
  const message = `Cannot ${operation} ${String(path)}`;
  if (isErrno(error, "ENOENT")) {
    return new FsNotFoundError(message, error, "ENOENT");
  }
  if (isErrno(error, "EACCES")) {
    return new FsDeniedError(message, error, "EACCES");
  }
  if (isErrno(error, "EPERM")) {
    return new FsDeniedError(message, error, "EPERM");
  }
  if (isErrno(error, "ENOTDIR")) {
    return new FsNotDirectoryError(message, error, "ENOTDIR");
  }
  if (isErrno(error, "EISDIR")) {
    return new FsIsDirectoryError(message, error, "EISDIR");
  }
  if (isErrno(error, "EEXIST")) {
    return new FsExistsError(message, error, "EEXIST");
  }
  // Only a failure of the system call itself: Node's own argument errors
  // (`ERR_*`) are bugs in the caller and stay as they are.
  if (
    typeof error === "object" &&
    error !== null &&
    "syscall" in error &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return new FsFailedError(`${message} (${error.code})`, error.code, error);
  }
  return error;
}

/**
 * Reads a file as text.
 *
 * @param path - The file to read.
 * @param encoding - How its bytes are decoded.
 * @returns The file's text.
 * @throws {@link FsError} When the file cannot be read.
 */
export function readFile(path: PathLike, encoding: BufferEncoding): Promise<string>;
/**
 * Reads a file as bytes.
 *
 * @param path - The file to read.
 * @returns The file's bytes.
 * @throws {@link FsError} When the file cannot be read.
 */
export function readFile(path: PathLike): Promise<Buffer>;
/**
 * Reads a file, as text when an encoding is given and as bytes otherwise.
 *
 * @param path - The file to read.
 * @param encoding - How its bytes are decoded, if they are.
 * @returns The file's text or bytes.
 * @throws {@link FsError} When the file cannot be read.
 */
export async function readFile(
  path: PathLike,
  encoding?: BufferEncoding,
): Promise<string | Buffer> {
  try {
    return encoding === undefined ? await nodeReadFile(path) : await nodeReadFile(path, encoding);
  } catch (error) {
    throw fsFailure(error, "read", path);
  }
}

/**
 * Writes a file, replacing what it held unless `options.flag` says otherwise.
 *
 * @param path - The file to write.
 * @param data - What it holds.
 * @param options - Its encoding, mode and open flag.
 * @throws {@link FsError} When the file cannot be written.
 */
export async function writeFile(
  path: PathLike,
  data: string | Uint8Array,
  options?: WriteFileOptions,
): Promise<void> {
  try {
    await nodeWriteFile(path, data, options);
  } catch (error) {
    throw fsFailure(error, "write", path);
  }
}

/**
 * Removes a file or, with `recursive`, a directory and everything in it.
 *
 * @param path - What to remove.
 * @param options - Whether to recurse, and whether a missing path is fine (`force`).
 * @throws {@link FsError} When it cannot be removed.
 */
export async function rm(path: PathLike, options?: RmOptions): Promise<void> {
  try {
    await nodeRm(path, options);
  } catch (error) {
    throw fsFailure(error, "remove", path);
  }
}

/**
 * Creates a directory.
 *
 * @param path - The directory to create.
 * @param options - Whether to create its parents too (`recursive`), and its mode.
 * @returns With `recursive`, the first directory it created, or `undefined`
 *   when every one was already there; otherwise `undefined`.
 * @throws {@link FsError} When it cannot be created.
 */
export async function mkdir(
  path: PathLike,
  options?: MakeDirectoryOptions,
): Promise<string | undefined> {
  try {
    return await nodeMkdir(path, options);
  } catch (error) {
    throw fsFailure(error, "create directory", path);
  }
}

/**
 * What is at a path, following symbolic links.
 *
 * @param path - The path to look at.
 * @returns Its stats.
 * @throws {@link FsError} When it cannot be looked at.
 */
export async function stat(path: PathLike): Promise<Stats> {
  try {
    return await nodeStat(path);
  } catch (error) {
    throw fsFailure(error, "inspect", path);
  }
}

/**
 * What is at a path, without following a symbolic link there.
 *
 * @param path - The path to look at.
 * @returns Its stats; a link's own, not its target's.
 * @throws {@link FsError} When it cannot be looked at.
 */
export async function lstat(path: PathLike): Promise<Stats> {
  try {
    return await nodeLstat(path);
  } catch (error) {
    throw fsFailure(error, "inspect", path);
  }
}

/**
 * Lists the names in a directory.
 *
 * @param path - The directory to list.
 * @returns The entry names, in no guaranteed order.
 * @throws {@link FsError} When it cannot be listed.
 */
export function readdir(path: PathLike): Promise<string[]>;
/**
 * Lists the entries of a directory, each with its type.
 *
 * @param path - The directory to list.
 * @param options - Asks for the entries with their types.
 * @returns The entries, in no guaranteed order.
 * @throws {@link FsError} When it cannot be listed.
 */
export function readdir(
  path: PathLike,
  options: {
    readonly withFileTypes: true;
  },
): Promise<Dirent[]>;
/**
 * Lists a directory, as names or, with `withFileTypes`, as typed entries.
 *
 * @param path - The directory to list.
 * @param options - Asks for the entries with their types.
 * @returns The names or the entries, in no guaranteed order.
 * @throws {@link FsError} When it cannot be listed.
 */
export async function readdir(
  path: PathLike,
  options?: {
    readonly withFileTypes: true;
  },
): Promise<string[] | Dirent[]> {
  try {
    return options === undefined
      ? await nodeReaddir(path)
      : await nodeReaddir(path, {
          withFileTypes: true,
        });
  } catch (error) {
    throw fsFailure(error, "list", path);
  }
}

/**
 * Moves or renames a file or directory.
 *
 * @param oldPath - Where it is.
 * @param newPath - Where it goes; an existing file there is replaced.
 * @throws {@link FsError} When it cannot be moved.
 */
export async function rename(oldPath: PathLike, newPath: PathLike): Promise<void> {
  try {
    await nodeRename(oldPath, newPath);
  } catch (error) {
    throw fsFailure(error, "rename", oldPath);
  }
}

/**
 * The canonical path of a path, with every symbolic link resolved.
 *
 * @param path - The path to resolve.
 * @returns The resolved path.
 * @throws {@link FsError} When it cannot be resolved, for example because it is missing.
 */
export async function realpath(path: PathLike): Promise<string> {
  try {
    return await nodeRealpath(path);
  } catch (error) {
    throw fsFailure(error, "resolve", path);
  }
}

/**
 * Opens a file.
 *
 * @param path - The file to open.
 * @param flags - How it is opened, such as `"r"`.
 * @param mode - Its mode, when it is created.
 * @returns The open file; the caller closes it.
 * @throws {@link FsError} When it cannot be opened.
 */
export async function open(
  path: PathLike,
  flags?: string | number,
  mode?: Mode,
): Promise<FileHandle> {
  try {
    return await nodeOpen(path, flags, mode);
  } catch (error) {
    throw fsFailure(error, "open", path);
  }
}

/**
 * Removes a file.
 *
 * @param path - The file to remove.
 * @throws {@link FsError} When it cannot be removed.
 */
export async function unlink(path: PathLike): Promise<void> {
  try {
    await nodeUnlink(path);
  } catch (error) {
    throw fsFailure(error, "remove", path);
  }
}

/**
 * Removes a file, synchronously, for a caller that cannot wait.
 *
 * @param path - The file to remove.
 * @throws {@link FsError} When it cannot be removed.
 */
export function unlinkSync(path: PathLike): void {
  try {
    nodeUnlinkSync(path);
  } catch (error) {
    throw fsFailure(error, "remove", path);
  }
}

/**
 * Checks that a path can be reached, and with `mode` what it allows.
 *
 * @param path - The path to check.
 * @param mode - The access to check, from `node:fs` `constants`; existence by default.
 * @throws {@link FsError} When it cannot be reached or does not allow `mode`.
 */
export async function access(path: PathLike, mode?: number): Promise<void> {
  try {
    await nodeAccess(path, mode);
  } catch (error) {
    throw fsFailure(error, "access", path);
  }
}

/**
 * Changes the mode of a file.
 *
 * @param path - The file.
 * @param mode - Its new mode, such as `0o600`.
 * @throws {@link FsError} When its mode cannot be changed.
 */
export async function chmod(path: PathLike, mode: Mode): Promise<void> {
  try {
    await nodeChmod(path, mode);
  } catch (error) {
    throw fsFailure(error, "change the mode of", path);
  }
}

/**
 * Copies a file or, with `recursive`, a directory tree.
 *
 * @param source - What to copy.
 * @param destination - Where the copy goes.
 * @param options - Whether to recurse and how to treat what is already there.
 * @throws {@link FsError} When it cannot be copied.
 */
export async function cp(
  source: string | URL,
  destination: string | URL,
  options?: CopyOptions,
): Promise<void> {
  try {
    await nodeCp(source, destination, options);
  } catch (error) {
    throw fsFailure(error, "copy", source);
  }
}

/**
 * Copies one file.
 *
 * @param source - The file to copy.
 * @param destination - Where the copy goes.
 * @param mode - Copy flags from `node:fs` `constants`, such as `COPYFILE_EXCL`.
 * @throws {@link FsError} When it cannot be copied.
 */
export async function copyFile(
  source: PathLike,
  destination: PathLike,
  mode?: number,
): Promise<void> {
  try {
    await nodeCopyFile(source, destination, mode);
  } catch (error) {
    throw fsFailure(error, "copy", source);
  }
}

/**
 * Creates a new, empty directory with a unique name.
 *
 * @param prefix - The path the name starts with; six random characters follow.
 * @returns The directory created.
 * @throws {@link FsError} When it cannot be created.
 */
export async function mkdtemp(prefix: string): Promise<string> {
  try {
    return await nodeMkdtemp(prefix);
  } catch (error) {
    throw fsFailure(error, "create a directory at", prefix);
  }
}

/**
 * Sets when a file was last read and changed.
 *
 * @param path - The file.
 * @param atime - When it was last read.
 * @param mtime - When it was last changed.
 * @throws {@link FsError} When its times cannot be set.
 */
export async function utimes(path: PathLike, atime: TimeLike, mtime: TimeLike): Promise<void> {
  try {
    await nodeUtimes(path, atime, mtime);
  } catch (error) {
    throw fsFailure(error, "set the times of", path);
  }
}

/**
 * Removes an empty directory.
 *
 * @param path - The directory.
 * @param options - Node's options for the removal.
 * @throws {@link FsError} When it cannot be removed, for example because it is not empty.
 */
export async function rmdir(path: PathLike, options?: RmDirOptions): Promise<void> {
  try {
    await nodeRmdir(path, options);
  } catch (error) {
    throw fsFailure(error, "remove", path);
  }
}

/**
 * The paths that match a glob pattern.
 *
 * @param pattern - The pattern, or several.
 * @param options - Where to search from and what to leave out.
 * @returns The matching paths, as they are found.
 * @throws {@link FsError} When the search cannot read a directory.
 */
export async function* glob(
  pattern: string | readonly string[],
  options: GlobOptionsWithoutFileTypes = {},
): AsyncGenerator<string> {
  try {
    yield* nodeGlob(pattern, options);
  } catch (error) {
    throw fsFailure(error, "search", options.cwd ?? String(pattern));
  }
}

/**
 * Whether anything exists at `path`.
 *
 * @remarks
 * Any failure to look, not only a missing path, reads as "no": use it to choose
 * between two ways forward, not to decide that a path is safe to touch.
 *
 * @param path - The path to look for.
 * @returns Whether it could be reached.
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error instanceof FsError) {
      return false;
    }
    throw error;
  }
}

/**
 * Reads a UTF-8 text file, treating a file that does not exist as "no text"
 * rather than as an error.
 *
 * @remarks
 * Only a missing file gives `undefined`. A file that exists but cannot be read,
 * such as one without read permission or a directory, still throws, so it is
 * not mistaken for an absent one.
 *
 * @param path - The file to read.
 * @returns The file's contents, or `undefined` when it does not exist.
 * @throws {@link FsError} When the file exists but cannot be read.
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
    if (error instanceof FsNotFoundError) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Lists the names in a directory, treating a directory that does not exist as an
 * empty one.
 *
 * @remarks
 * Some directories the CLI lists may not exist yet, such as the directory
 * `setup` is about to scaffold an app into, so "no such folder" and "no files in
 * the folder" mean the same thing to the caller. A directory that exists but
 * cannot be listed, or a file where a directory should be, still throws, so a
 * broken layout is reported and not mistaken for an empty folder.
 *
 * @param path - The directory to list.
 * @returns The entry names, in no guaranteed order, or `[]` when the directory
 *   does not exist.
 * @throws {@link FsError} When the directory exists but cannot be listed.
 */
export async function readDirIfExists(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if (error instanceof FsNotFoundError) {
      return [];
    }
    throw error;
  }
}

/**
 * Whether anything exists at `path`, false only when it is missing.
 *
 * @remarks
 * A path that cannot be looked at for another reason (permissions, a file where
 * a directory should be) throws, so it is not mistaken for an absent one.
 *
 * @param path - The path to look for.
 * @returns Whether it exists.
 * @throws {@link FsError} When it cannot be looked at for a reason other than being missing.
 */
export async function pathExistsStrict(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error instanceof FsNotFoundError) {
      return false;
    }
    throw error;
  }
}

/**
 * Whether an entry exists at `path`, a link counting as an entry even when what
 * it points at is missing.
 *
 * @param path - What to look for.
 * @returns Whether an entry is there.
 * @throws {@link FsError} When it cannot be looked at for a reason other than being missing.
 */
export async function entryExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof FsNotFoundError) {
      return false;
    }
    throw error;
  }
}

/**
 * A file's text, or `undefined` when it is absent or cannot be read.
 *
 * @remarks
 * For a report on the state of files, where one that cannot be read is shown as
 * missing instead of aborting the rest.
 *
 * @param path - The file to read.
 * @returns Its text, or `undefined`.
 */
export async function readIfReadable(path: string): Promise<string | undefined> {
  try {
    return await readIfExists(path);
  } catch (error) {
    if (error instanceof FsError) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Whether `path` is a regular file.
 *
 * @remarks
 * Answers `false` for anything else: a directory, a socket, a path that does
 * not exist, or a path that cannot be looked at. This is the lenient check, for
 * "is there a file here I can use" decisions where every kind of no is the same
 * no. Use {@link pathExistsStrict} when a path that cannot be inspected should
 * be an error. Symbolic links are followed, so a link to a file counts as a file.
 *
 * @param path - The path to check.
 * @returns `true` when the path leads to a regular file.
 */
export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error instanceof FsError) {
      return false;
    }
    throw error;
  }
}

/**
 * Reads a file as text, blocking until it is read.
 *
 * @remarks
 * For the few callers that must stay synchronous; everything else uses
 * {@link readFile}.
 *
 * @param path - The file to read.
 * @param encoding - How its bytes are decoded.
 * @returns The file's text.
 * @throws {@link FsError} When the file cannot be read.
 */
export function readFileSync(path: PathLike, encoding: BufferEncoding): string {
  try {
    return nodeReadFileSync(path, encoding);
  } catch (error) {
    throw fsFailure(error, "read", path);
  }
}

/**
 * Writes a file, blocking until it is written, replacing what it held unless
 * `options.flag` says otherwise.
 *
 * @param path - The file to write.
 * @param data - What it holds.
 * @param options - Its encoding, mode and open flag.
 * @throws {@link FsError} When the file cannot be written; {@link FsExistsError}
 *   when `flag` is `wx` and the file is already there.
 */
export function writeFileSync(
  path: PathLike,
  data: string | Uint8Array,
  options?: WriteFileOptions,
): void {
  try {
    nodeWriteFileSync(path, data, options);
  } catch (error) {
    throw fsFailure(error, "write", path);
  }
}

/**
 * Creates a directory, blocking until it is created.
 *
 * @param path - The directory to create.
 * @param options - Whether to create its parents too (`recursive`), and its mode.
 * @returns With `recursive`, the first directory it created, or `undefined`
 *   when every one was already there; otherwise `undefined`.
 * @throws {@link FsError} When it cannot be created.
 */
export function mkdirSync(path: PathLike, options?: MakeDirectoryOptions): string | undefined {
  try {
    return nodeMkdirSync(path, options);
  } catch (error) {
    throw fsFailure(error, "create directory", path);
  }
}

/**
 * Moves a file or directory, blocking until it is moved.
 *
 * @param oldPath - Where it is.
 * @param newPath - Where it goes, replacing a file already there.
 * @throws {@link FsError} When it cannot be moved.
 */
export function renameSync(oldPath: PathLike, newPath: PathLike): void {
  try {
    nodeRenameSync(oldPath, newPath);
  } catch (error) {
    throw fsFailure(error, "rename", oldPath);
  }
}

/**
 * Removes a file or, with `recursive`, a directory and everything in it,
 * blocking until it is removed.
 *
 * @param path - What to remove.
 * @param options - Whether to recurse, and whether a missing path is fine (`force`).
 * @throws {@link FsError} When it cannot be removed.
 */
export function rmSync(path: PathLike, options?: RmOptions): void {
  try {
    nodeRmSync(path, options);
  } catch (error) {
    throw fsFailure(error, "remove", path);
  }
}
