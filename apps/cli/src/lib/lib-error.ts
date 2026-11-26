import type { ErrorCategory, ZitadelErrorCode } from "./errors";

/**
 * The base of every error a package raises on purpose.
 *
 * @remarks
 * A package's own base extends this, and each condition extends that. The
 * boundary reports any of them by the `code` the class states, without
 * knowing which package raised it.
 */
export abstract class ZitadelLibError extends Error {
  /** The kind of failure; a subclass states its own. */
  abstract readonly category: ErrorCategory;

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  abstract readonly retryable: boolean;

  /** The stable product code the failure is reported with; a subclass states its own. */
  abstract readonly code: ZitadelErrorCode;

  /**
   * Make a package failure.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param cause - The failure this one wraps, when it wraps one.
   */
  constructor(message: string, cause?: unknown) {
    super(
      message,
      cause === undefined
        ? undefined
        : {
            cause,
          },
    );
    this.name = new.target.name;
  }
}
