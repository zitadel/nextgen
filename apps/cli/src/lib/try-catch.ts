/**
 * Calls `fn` and returns what it threw or what it returned as a pair, so the
 * caller guards the failure with an `if` instead of assigning inside a `try`.
 *
 * ```ts
 * const [error, module] = tryCatch(parseModule, source);
 * if (error) {
 *   throw new ZitadelError(...);
 * }
 * ```
 *
 * A thrown value that is not an `Error` is wrapped in one, so `error` is always
 * an `Error` and `error.message` is always safe to read.
 *
 * @param fn - The function to call. It must be synchronous.
 * @param args - Passed to `fn`.
 * @returns `[error, undefined]` when `fn` threw, else `[null, result]`.
 */
export function tryCatch<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
  ...args: Args
): [Error, undefined] | [null, Result] {
  try {
    return [null, fn(...args)];
  } catch (error) {
    return [error instanceof Error ? error : new Error(String(error)), undefined];
  }
}
