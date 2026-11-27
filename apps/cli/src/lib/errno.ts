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

/**
 * The `errno` code a caught value carries, such as `ENOENT`.
 *
 * @remarks
 * For the one reader that must name the code itself rather than test for one:
 * `toZitadelError`, which keeps it in the details of the error it reports.
 *
 * @param error - Whatever was caught.
 * @returns The code, or `undefined` when the value carries no string `code`.
 */
export function errnoOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  if (typeof error.code !== "string") {
    return undefined;
  }
  return error.code;
}
