import {
  FsDeniedError,
  FsExistsError,
  FsFailedError,
  FsIsDirectoryError,
  FsNotDirectoryError,
  FsNotFoundError,
} from "@/lib/fs";

import type { Row } from "./row";

/** The project file every read row reads. */
const CONFIG = "/work/app/zitadel.json";

/** The project's secret directory. */
const SECRET_DIR = "/work/app/.zitadel";

/** The project's secret file. */
const SECRET = "/work/app/.zitadel/secret";

/**
 * An error as Node's file-system calls raise it.
 *
 * @param code - The errno code.
 * @param message - Node's own message.
 * @param syscall - The system call that failed.
 * @param path - The path it failed on.
 * @returns The error, carrying the code, syscall and path.
 */
function nodeError(code: string, message: string, syscall: string, path: string): Error {
  return Object.assign(new Error(message), { code, errno: -1, syscall, path });
}

/** Node's message for a missing `zitadel.json`. */
const ENOENT_MESSAGE = `ENOENT: no such file or directory, open '${CONFIG}'`;

/** Node's message for an unreadable `zitadel.json`. */
const EACCES_MESSAGE = `EACCES: permission denied, open '${CONFIG}'`;

/** Node's message for a secret that may not be removed. */
const EPERM_MESSAGE = `EPERM: operation not permitted, unlink '${SECRET}'`;

/** Node's message for listing a file as a directory. */
const ENOTDIR_MESSAGE = `ENOTDIR: not a directory, scandir '${CONFIG}'`;

/** Node's message for reading a directory as a file. */
const EISDIR_MESSAGE = "EISDIR: illegal operation on a directory, read";

/** Node's message for a directory that already exists as a file. */
const EEXIST_MESSAGE = `EEXIST: file already exists, mkdir '${SECRET_DIR}'`;

/** Node's message for a symbolic link loop. */
const ELOOP_MESSAGE = `ELOOP: too many symbolic links encountered, open '${CONFIG}'`;

/** The errors of `@/lib/fs`, each with what main showed for it. */
export const FS_ROWS: readonly Row[] = [
  {
    error: new FsNotFoundError(
      `Cannot read ${CONFIG}`,
      nodeError("ENOENT", ENOENT_MESSAGE, "open", CONFIG),
    ),
    main: "lib/project/project-config.ts:48",
    expected: {
      code: "E_VALIDATION",
      message: ENOENT_MESSAGE,
      hint: "A required file or directory is missing.",
      details: {
        original: { name: "Error", message: ENOENT_MESSAGE, code: "ENOENT" },
      },
      exitCode: 3,
    },
  },
  {
    case: "a file the process may not read",
    error: new FsDeniedError(
      `Cannot read ${CONFIG}`,
      nodeError("EACCES", EACCES_MESSAGE, "open", CONFIG),
    ),
    main: "lib/project/project-config.ts:48",
    expected: {
      code: "E_AUTH",
      message: `Permission denied: ${EACCES_MESSAGE}`,
      hint: "Check file permissions or run with the right user.",
      details: {
        original: { name: "Error", message: EACCES_MESSAGE, code: "EACCES" },
      },
      exitCode: 1,
    },
  },
  {
    case: "a file the operating system will not let the process remove",
    error: new FsDeniedError(
      `Cannot remove ${SECRET}`,
      nodeError("EPERM", EPERM_MESSAGE, "unlink", SECRET),
    ),
    main: "lib/project/secret-file.ts:98",
    expected: {
      code: "E_AUTH",
      message: `Permission denied: ${EPERM_MESSAGE}`,
      hint: "Check file permissions or run with the right user.",
      details: {
        original: { name: "Error", message: EPERM_MESSAGE, code: "EPERM" },
      },
      exitCode: 1,
    },
  },
  {
    error: new FsNotDirectoryError(
      `Cannot list ${CONFIG}`,
      nodeError("ENOTDIR", ENOTDIR_MESSAGE, "scandir", CONFIG),
    ),
    main: "lib/project/project-config.ts:48",
    expected: {
      code: "E_VALIDATION",
      message: ENOTDIR_MESSAGE,
      details: {
        original: { name: "Error", message: ENOTDIR_MESSAGE, code: "ENOTDIR" },
      },
      exitCode: 3,
    },
  },
  {
    error: new FsIsDirectoryError(
      `Cannot read ${CONFIG}`,
      nodeError("EISDIR", EISDIR_MESSAGE, "read", CONFIG),
    ),
    main: "lib/project/project-config.ts:48",
    expected: {
      code: "E_VALIDATION",
      message: EISDIR_MESSAGE,
      details: {
        original: { name: "Error", message: EISDIR_MESSAGE, code: "EISDIR" },
      },
      exitCode: 3,
    },
  },
  {
    error: new FsExistsError(
      `Cannot create directory ${SECRET_DIR}`,
      nodeError("EEXIST", EEXIST_MESSAGE, "mkdir", SECRET_DIR),
    ),
    main: "lib/project/project-secret.ts:136",
    expected: {
      code: "E_CONFLICT",
      message: EEXIST_MESSAGE,
      hint: "A file already exists. Use --force to overwrite or remove it first.",
      details: {
        original: { name: "Error", message: EEXIST_MESSAGE, code: "EEXIST" },
      },
      exitCode: 5,
    },
  },
  {
    error: new FsFailedError(
      `Cannot read ${CONFIG} (ELOOP)`,
      "ELOOP",
      nodeError("ELOOP", ELOOP_MESSAGE, "open", CONFIG),
    ),
    main: "lib/project/project-config.ts:48",
    expected: {
      code: "E_VALIDATION",
      message: ELOOP_MESSAGE,
      details: {
        original: { name: "Error", message: ELOOP_MESSAGE, code: "ELOOP" },
      },
      exitCode: 3,
    },
  },
];
