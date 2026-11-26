/**
 * The file-system calls of the CLI, throwing typed errors.
 *
 * @remarks
 * Every function here has the name and call signature of its `node:fs/promises`
 * namesake. It calls Node and turns a failure with a known `errno` code into the
 * matching class of `./errors`, naming the operation and the path and keeping
 * Node's error as `cause`. Any other error is rethrown as Node raised it.
 *
 * This is the one place that reads the `code` of a Node error. Everything else
 * imports file-system calls from here, never from `node:fs/promises`, and
 * catches {@link FsNotFoundError} and its siblings by class.
 */
import type { BufferView, NonSharedBuffer } from "node:buffer";
import type {
  BigIntStats,
  BufferEncodingOption,
  CopyOptions,
  Dirent,
  GlobOptionsWithoutFileTypes,
  MakeDirectoryOptions,
  Mode,
  ObjectEncodingOptions,
  PathLike,
  ReadFileOptions,
  ReadFileOptionsWithBuffer,
  ReadFileOptionsWithBufferEncoding,
  ReadFileOptionsWithStringEncoding,
  RmDirOptions,
  StatOptions,
  Stats,
  TimeLike,
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
 * Every wrapper in this module uses it, and it is the only reader of a Node
 * error's `code` in the CLI.
 *
 * @param error - Whatever the Node call threw.
 * @param operation - What the call was doing, as a verb, for the message.
 * @param path - What it was doing it to.
 * @returns The typed error for a known code, {@link FsFailedError} for any other
 *   errno code, otherwise `error` itself.
 */
function fsFailure(error: unknown, operation: string, path: unknown): unknown {
  const message = `Cannot ${operation} ${String(path)}`;
  if (isErrno(error, "ENOENT")) {
    return new FsNotFoundError(message, error);
  }
  if (isErrno(error, "EACCES") || isErrno(error, "EPERM")) {
    return new FsDeniedError(message, error);
  }
  if (isErrno(error, "ENOTDIR")) {
    return new FsNotDirectoryError(message, error);
  }
  if (isErrno(error, "EISDIR")) {
    return new FsIsDirectoryError(message, error);
  }
  if (isErrno(error, "EEXIST")) {
    return new FsExistsError(message, error);
  }
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return new FsFailedError(`${message} (${error.code})`, error);
  }
  return error;
}

/** `readFile` of `node:fs/promises`, throwing typed errors. */
export function readFile<T extends NodeJS.ArrayBufferView>(
  path: PathLike | FileHandle,
  options: ReadFileOptionsWithBuffer<T>,
): Promise<BufferView<T>>;
export function readFile(
  path: PathLike | FileHandle,
  options?: ReadFileOptionsWithBufferEncoding | null,
): Promise<NonSharedBuffer>;
export function readFile(
  path: PathLike | FileHandle,
  options: ReadFileOptionsWithStringEncoding | BufferEncoding,
): Promise<string>;
export function readFile(
  path: PathLike | FileHandle,
  options: ReadFileOptions | BufferEncoding | null,
): Promise<string | NonSharedBuffer>;
export async function readFile(path: PathLike | FileHandle, options?: unknown): Promise<unknown> {
  try {
    return await nodeReadFile(path, options as never);
  } catch (error) {
    throw fsFailure(error, "read", path);
  }
}

/** `writeFile` of `node:fs/promises`, throwing typed errors. */
export async function writeFile(...args: Parameters<typeof nodeWriteFile>): Promise<void> {
  try {
    await nodeWriteFile(...args);
  } catch (error) {
    throw fsFailure(error, "write", args[0]);
  }
}

/** `rm` of `node:fs/promises`, throwing typed errors. */
export async function rm(...args: Parameters<typeof nodeRm>): Promise<void> {
  try {
    await nodeRm(...args);
  } catch (error) {
    throw fsFailure(error, "remove", args[0]);
  }
}

/** `mkdir` of `node:fs/promises`, throwing typed errors. */
export function mkdir(
  path: PathLike,
  options: MakeDirectoryOptions & {
    recursive: true;
  },
): Promise<string | undefined>;
export function mkdir(
  path: PathLike,
  options?:
    | Mode
    | (MakeDirectoryOptions & {
        recursive?: false | undefined;
      })
    | null,
): Promise<void>;
export function mkdir(
  path: PathLike,
  options?: Mode | MakeDirectoryOptions | null,
): Promise<string | undefined>;
export async function mkdir(path: PathLike, options?: unknown): Promise<unknown> {
  try {
    return await nodeMkdir(path, options as never);
  } catch (error) {
    throw fsFailure(error, "create directory", path);
  }
}

/** `stat` of `node:fs/promises`, throwing typed errors. */
export function stat(
  path: PathLike,
  options?: StatOptions & {
    bigint?: false | undefined;
  },
): Promise<Stats>;
export function stat(
  path: PathLike,
  options: StatOptions & {
    bigint: true;
  },
): Promise<BigIntStats>;
export function stat(path: PathLike, options?: StatOptions): Promise<Stats | BigIntStats>;
export async function stat(path: PathLike, options?: StatOptions): Promise<Stats | BigIntStats> {
  try {
    return await nodeStat(path, options);
  } catch (error) {
    throw fsFailure(error, "inspect", path);
  }
}

/** `lstat` of `node:fs/promises`, throwing typed errors. */
export function lstat(
  path: PathLike,
  options?: StatOptions & {
    bigint?: false | undefined;
  },
): Promise<Stats>;
export function lstat(
  path: PathLike,
  options: StatOptions & {
    bigint: true;
  },
): Promise<BigIntStats>;
export function lstat(path: PathLike, options?: StatOptions): Promise<Stats | BigIntStats>;
export async function lstat(path: PathLike, options?: StatOptions): Promise<Stats | BigIntStats> {
  try {
    return await nodeLstat(path, options);
  } catch (error) {
    throw fsFailure(error, "inspect", path);
  }
}

/** `readdir` of `node:fs/promises`, throwing typed errors. */
export function readdir(
  path: PathLike,
  options?:
    | (ObjectEncodingOptions & {
        withFileTypes?: false | undefined;
        recursive?: boolean | undefined;
      })
    | BufferEncoding
    | null,
): Promise<string[]>;
export function readdir(
  path: PathLike,
  options:
    | {
        encoding: "buffer";
        withFileTypes?: false | undefined;
        recursive?: boolean | undefined;
      }
    | "buffer",
): Promise<NonSharedBuffer[]>;
export function readdir(
  path: PathLike,
  options?:
    | (ObjectEncodingOptions & {
        withFileTypes?: false | undefined;
        recursive?: boolean | undefined;
      })
    | BufferEncoding
    | null,
): Promise<string[] | NonSharedBuffer[]>;
export function readdir(
  path: PathLike,
  options: ObjectEncodingOptions & {
    withFileTypes: true;
    recursive?: boolean | undefined;
  },
): Promise<Dirent[]>;
export function readdir(
  path: PathLike,
  options: {
    encoding: "buffer";
    withFileTypes: true;
    recursive?: boolean | undefined;
  },
): Promise<Dirent<NonSharedBuffer>[]>;
export async function readdir(path: PathLike, options?: unknown): Promise<unknown> {
  try {
    return await nodeReaddir(path, options as never);
  } catch (error) {
    throw fsFailure(error, "list", path);
  }
}

/** `rename` of `node:fs/promises`, throwing typed errors. */
export async function rename(oldPath: PathLike, newPath: PathLike): Promise<void> {
  try {
    await nodeRename(oldPath, newPath);
  } catch (error) {
    throw fsFailure(error, "rename", oldPath);
  }
}

/** `realpath` of `node:fs/promises`, throwing typed errors. */
export function realpath(
  path: PathLike,
  options?: ObjectEncodingOptions | BufferEncoding | null,
): Promise<string>;
export function realpath(path: PathLike, options: BufferEncodingOption): Promise<NonSharedBuffer>;
export function realpath(
  path: PathLike,
  options?: ObjectEncodingOptions | BufferEncoding | null,
): Promise<string | NonSharedBuffer>;
export async function realpath(path: PathLike, options?: unknown): Promise<unknown> {
  try {
    return await nodeRealpath(path, options as never);
  } catch (error) {
    throw fsFailure(error, "resolve", path);
  }
}

/** `open` of `node:fs/promises`, throwing typed errors. */
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

/** `unlink` of `node:fs/promises`, throwing typed errors. */
export async function unlink(path: PathLike): Promise<void> {
  try {
    await nodeUnlink(path);
  } catch (error) {
    throw fsFailure(error, "remove", path);
  }
}

/** `access` of `node:fs/promises`, throwing typed errors. */
export async function access(path: PathLike, mode?: number): Promise<void> {
  try {
    await nodeAccess(path, mode);
  } catch (error) {
    throw fsFailure(error, "access", path);
  }
}

/** `chmod` of `node:fs/promises`, throwing typed errors. */
export async function chmod(path: PathLike, mode: Mode): Promise<void> {
  try {
    await nodeChmod(path, mode);
  } catch (error) {
    throw fsFailure(error, "change the mode of", path);
  }
}

/** `cp` of `node:fs/promises`, throwing typed errors. */
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

/** `copyFile` of `node:fs/promises`, throwing typed errors. */
export async function copyFile(src: PathLike, dest: PathLike, mode?: number): Promise<void> {
  try {
    await nodeCopyFile(src, dest, mode);
  } catch (error) {
    throw fsFailure(error, "copy", src);
  }
}

/** `mkdtemp` of `node:fs/promises`, throwing typed errors. */
export async function mkdtemp(
  prefix: string,
  options?: ObjectEncodingOptions | BufferEncoding | null,
): Promise<string> {
  try {
    return await nodeMkdtemp(prefix, options);
  } catch (error) {
    throw fsFailure(error, "create a directory at", prefix);
  }
}

/** `utimes` of `node:fs/promises`, throwing typed errors. */
export async function utimes(path: PathLike, atime: TimeLike, mtime: TimeLike): Promise<void> {
  try {
    await nodeUtimes(path, atime, mtime);
  } catch (error) {
    throw fsFailure(error, "set the times of", path);
  }
}

/** `rmdir` of `node:fs/promises`, throwing typed errors. */
export async function rmdir(path: PathLike, options?: RmDirOptions): Promise<void> {
  try {
    await nodeRmdir(path, options);
  } catch (error) {
    throw fsFailure(error, "remove", path);
  }
}

/** `glob` of `node:fs/promises` yielding path strings, throwing typed errors. */
export async function* glob(
  pattern: string | readonly string[],
  options: GlobOptionsWithoutFileTypes = {},
): AsyncGenerator<string> {
  try {
    yield* nodeGlob(pattern, options);
  } catch (error) {
    throw fsFailure(error, "search", options.cwd ?? pattern);
  }
}

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
    if (error instanceof FsNotFoundError) {
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
    if (error instanceof FsNotFoundError) {
      return false;
    }
    throw error;
  }
}

/**
 * Whether an entry exists at `path`, a link counting as an entry even when what
 * it points at is missing. False only when nothing is there; any other failure
 * to look throws.
 *
 * @param path - What to look for.
 * @returns Whether an entry is there.
 * @throws Any `lstat` error other than the entry being missing.
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
 * A file's text, or `undefined` when it is absent or cannot be read. For a
 * report on the state of files, where one that cannot be read is shown as
 * missing instead of aborting the rest.
 */
export async function readIfReadable(path: string): Promise<string | undefined> {
  try {
    return await readIfExists(path);
  } catch {
    return undefined;
  }
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
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error instanceof FsError) {
      return false;
    }
    throw error;
  }
}
