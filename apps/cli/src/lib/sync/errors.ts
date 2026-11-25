import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything reading the record of what was synced fails with on purpose.
 *
 * @remarks
 * A caller catches this, or one of its subclasses; the CLI turns it into its
 * own error in one place. A failure nothing here anticipated, such as the
 * operating system refusing to read the file, is not one of these: it bubbles
 * as it was thrown.
 */
export abstract class SyncError extends Error {
  /** The kind of failure, which the boundary reports it as. */
  abstract readonly category: ErrorCategory;

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  abstract readonly retryable: boolean;

  /** The stable product code the failure is reported with. */
  abstract readonly code: ZitadelErrorCode;

  /**
   * Make a sync failure.
   *
   * @param message - What went wrong.
   * @param options - The error that caused this one, if any.
   */
  constructor(
    message: string,
    options: {
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * The state file is there but does not read as what it should be: it is not
 * JSON, or a section of it has the wrong shape.
 */
export class SyncStateMalformedError extends SyncError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * What to do about it.
   */
  readonly hint: string =
    "The file records which platform resource each local file was synced as. " +
    "Fix or remove it, then run this command again.";

  /**
   * Structured facts about the failure, for a `--json` reader.
   */
  readonly details: Readonly<Record<string, unknown>>;

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
  constructor(
    file: string,
    problem: string,
    options: {
      readonly cause?: unknown;
    } = {},
  ) {
    super(`Cannot read ${file}: ${problem}`, options);
    this.details = {
      file,
    };
    this.file = file;
    this.problem = problem;
  }
}
