import type { ErrorCategory, ZitadelErrorCode } from "./errors";
import { snake } from "./names";

/**
 * The fields every error carries that are not facts about what failed: the
 * report states them in its own fields, or not at all.
 */
const UNSPOKEN: ReadonlySet<string> = new Set([
  "name",
  "stack",
  "cause",
  "code",
  "category",
  "retryable",
  "message",
  "hint",
]);

/**
 * The base of every error a package raises on purpose.
 *
 * @remarks
 * A package's own base extends this, and each condition extends that. The
 * boundary reports any of them by the `code` the class states, its `message`,
 * its `hint` and its `details`, without knowing which package raised it.
 */
export abstract class ZitadelLibError extends Error {
  /** The kind of failure; a subclass states its own. */
  abstract readonly category: ErrorCategory;

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  abstract readonly retryable: boolean;

  /** The stable product code the failure is reported with; a subclass states its own. */
  abstract readonly code: ZitadelErrorCode;

  /**
   * Advice about the world that may settle the failure: a file to fix, a
   * permission, a value. A subclass that has some states it, built from its
   * own facts where it is made; it never names a command or a flag of the CLI.
   */
  readonly hint: string | undefined = undefined;

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

  /**
   * The facts a report shows of the failure: each field the error has a value
   * for, keyed in snake_case, apart from those every error carries. A subclass
   * whose report shows other facts states its own.
   *
   * @returns The facts, by name.
   */
  get details(): Readonly<Record<string, unknown>> {
    return Object.fromEntries(
      Object.entries(this)
        .filter(([key, value]) => {
          return !UNSPOKEN.has(key) && value !== undefined;
        })
        .map(([key, value]) => {
          return [snake(key), value];
        }),
    );
  }
}
