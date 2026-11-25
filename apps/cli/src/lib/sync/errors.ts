import {
  categoryCode,
  type Categorized,
  type ErrorCategory,
  type ZitadelErrorCode,
} from "@/lib/errors";

/**
 * What a sync failure carries beyond its message.
 */
export type SyncErrorOptions = {
  /**
   * What to do about it, in words that name no command or flag.
   */
  readonly hint?: string | undefined;

  /**
   * Structured facts about the failure, for a `--json` reader.
   */
  readonly details?: Readonly<Record<string, unknown>> | undefined;

  /**
   * The error that caused this one.
   */
  readonly cause?: unknown;
};

/**
 * Anything reading the record of what was synced fails with on purpose.
 *
 * @remarks
 * A caller catches this, or one of its subclasses; the CLI turns it into its
 * own error in one place. A failure nothing here anticipated, such as the
 * operating system refusing to read the file, is not one of these: it bubbles
 * as it was thrown.
 */
export class SyncError extends Error implements Categorized {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "SyncError";

  /** The kind of failure; a subclass states its own. */
  readonly category: ErrorCategory = "invalid";

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  readonly retryable: boolean = false;

  /**
   * The stable product code the failure is reported with, which is the one
   * its category has unless a class's condition has a code of its own.
   */
  get code(): ZitadelErrorCode {
    return categoryCode(this.category);
  }

  /**
   * What to do about it.
   */
  readonly hint: string | undefined;

  /**
   * Structured facts about the failure, for a `--json` reader.
   */
  readonly details: Readonly<Record<string, unknown>> | undefined;

  /**
   * Make a sync failure.
   *
   * @param message - What went wrong.
   * @param options - What to do about it, the facts behind it, and its cause.
   */
  constructor(message: string, options: SyncErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.hint = options.hint;
    this.details = options.details;
  }
}

/**
 * The state file is there but does not read as what it should be: it is not
 * JSON, or a section of it has the wrong shape.
 */
export class SyncStateMalformedError extends SyncError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "SyncStateMalformedError";
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;

  /**
   * The state file's path, relative to the project.
   */
  readonly file: string;

  /**
   * What is wrong with it.
   */
  readonly problem: string;

  /**
   * Make the failure.
   *
   * @param file - The state file's path, relative to the project.
   * @param problem - What is wrong with it.
   * @param options - The cause.
   */
  constructor(file: string, problem: string, options: SyncErrorOptions = {}) {
    super(`Cannot read ${file}: ${problem}`, {
      hint:
        "The file records which platform resource each local file was synced as. " +
        "Fix or remove it, then run this command again.",
      details: { file },
      ...options,
    });
    this.file = file;
    this.problem = problem;
  }
}
