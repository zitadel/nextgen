/**
 * Whether a caught value is a system error with the given `errno` code, such as `ENOENT`.
 *
 * It looks only at the value's own `code`, so it needs nothing of the error types the CLI defines.
 *
 * @param error - Whatever was caught.
 * @param code - The code to look for.
 * @returns `true` when the value is an object whose `code` is `code`.
 */
export function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
