import { isCancellation, toZitadelError } from "@/lib/errors";
import { reportWarning } from "@/lib/warnings";

/**
 * A read that only adds to what a command shows, which warns and answers
 * `none` when it fails instead of failing the command.
 *
 * @remarks
 * What the command was asked for has been read by the time this runs, or is
 * read beside it. A failure to read what decorates it, such as a permission
 * the caller lacks or a server that does not answer, then costs the
 * decoration, and the warning says which.
 *
 * @param what - What is read, in words a person reads after "Could not read".
 * @param read - The read, which may fail.
 * @param none - What to answer when it fails.
 * @returns What `read` answers, or `none` after a warning when it fails.
 * @throws ZitadelError `E_CANCELLED` when the run was cancelled while reading.
 */
export async function readingOptionally<T, N = T>(
  what: string,
  read: () => Promise<T>,
  none: N,
): Promise<T | N> {
  return read().catch((error: unknown): N => {
    if (isCancellation(error)) {
      throw error;
    }
    reportWarning(`Could not read ${what}: ${toZitadelError(error).message}`);
    return none;
  });
}
