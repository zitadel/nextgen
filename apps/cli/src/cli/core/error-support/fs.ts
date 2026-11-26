import {
  FsDeniedError,
  FsExistsError,
  FsFailedError,
  FsIsDirectoryError,
  FsNotDirectoryError,
  FsNotFoundError,
} from "@/lib/fs";

import type { Refusal } from "@/cli/core/refusal";
import type { Wording } from "./wording";

/** How a file or folder the run needs and does not find is refused. */
const NOT_FOUND_REFUSAL = {
  message: "{message}",
  hint: "A required file or directory is missing.",
} as const satisfies Refusal;

/** How a file the operating system will not let the run read or write is refused. */
const DENIED_REFUSAL = {
  message: "Permission denied: {message}",
  hint: "Check file permissions or run with the right user.",
} as const satisfies Refusal;

/** How a file that stands where the run would write one is refused. */
const EXISTS_REFUSAL = {
  message: "{message}",
  hint: "A file already exists. Use --force to overwrite or remove it first.",
} as const satisfies Refusal;

/** How a file that stands where a folder is needed is refused. */
const NOT_DIRECTORY_REFUSAL = {
  message: "{message}",
} as const satisfies Refusal;

/** How a folder that stands where a file is needed is refused. */
const IS_DIRECTORY_REFUSAL = {
  message: "{message}",
} as const satisfies Refusal;

/** How any other failure of a file-system call is refused. */
const FAILED_REFUSAL = {
  message: "{message}",
} as const satisfies Refusal;

/** How the errors of `@/lib/fs` are worded, most specific class first. */
export const FS_WORDINGS: readonly Wording[] = [
  [FsNotFoundError, NOT_FOUND_REFUSAL],
  [FsDeniedError, DENIED_REFUSAL],
  [FsExistsError, EXISTS_REFUSAL],
  [FsNotDirectoryError, NOT_DIRECTORY_REFUSAL],
  [FsIsDirectoryError, IS_DIRECTORY_REFUSAL],
  [FsFailedError, FAILED_REFUSAL],
];
