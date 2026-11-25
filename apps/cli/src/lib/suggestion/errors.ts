import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything the suggestion renderer fails with on purpose.
 *
 * @remarks
 * Every one is a guard on a suggestion that CLI code built wrongly: a person
 * never types a suggestion, so none is the person's to fix.
 */
export abstract class SuggestionError extends Error {
  /** The kind of failure. */
  abstract readonly category: ErrorCategory;

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  abstract readonly retryable: boolean;

  /** The stable product code the failure is reported with. */
  abstract readonly code: ZitadelErrorCode;

  /** What to do about it. */
  abstract readonly hint: string | undefined;

  /** Structured facts about the failure, for a `--json` reader. */
  readonly details: Readonly<Record<string, unknown>> | undefined;

  /**
   * Make a suggestion failure.
   *
   * @param message - What went wrong.
   * @param options - The facts behind it and its cause.
   */
  constructor(
    message: string,
    options: {
      details?: Readonly<Record<string, unknown>> | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(
      message,
      options.cause === undefined
        ? undefined
        : {
            cause: options.cause,
          },
    );
    this.name = new.target.name;
    this.details = options.details;
  }
}

/**
 * A suggestion that is built wrongly: it names a command that does not exist, a
 * flag or argument the command does not declare, or leaves out one it requires.
 * That is a defect in the CLI code that built it.
 */
export class SuggestionInternalError extends SuggestionError {
  override readonly category: ErrorCategory = "fault";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string | undefined = undefined;
}
