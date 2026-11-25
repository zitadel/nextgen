import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything asking for consent fails with on purpose.
 *
 * @remarks
 * A caller catches this, or one of its subclasses; the CLI turns it into its
 * own error in one place.
 */
export abstract class ConsentError extends Error {
  /** The kind of failure; a subclass states its own. */
  abstract readonly category: ErrorCategory;

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  abstract readonly retryable: boolean;

  /** The stable product code the failure is reported with. */
  abstract readonly code: ZitadelErrorCode;

  /**
   * What to do about it.
   */
  readonly hint: string | undefined;

  /**
   * Structured facts about the failure, for a `--json` reader.
   */
  readonly details: Readonly<Record<string, unknown>> | undefined;

  /**
   * Make a consent failure.
   *
   * @param message - What went wrong.
   * @param options - What to do about it, the facts behind it, and its cause.
   */
  constructor(
    message: string,
    options: {
      readonly hint?: string | undefined;
      readonly details?: Readonly<Record<string, unknown>> | undefined;
      readonly cause?: unknown;
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
    this.hint = options.hint;
    this.details = options.details;
  }
}

/**
 * Nobody can be asked and consent was not given in advance, so the action is
 * refused: only a person may agree to it.
 */
export class ConsentRequiredError extends ConsentError {
  override readonly category = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFIRMATION_REQUIRED";

  /**
   * Make the failure.
   *
   * @param action - The action as a lowercase phrase.
   * @param question - The question a person would have been asked.
   */
  constructor(action: string, question: string) {
    super(`Cannot ${action} without --force in non-interactive mode`, {
      hint: question,
      details: {
        question,
      },
    });
  }
}

/**
 * A bug in this package: something that cannot happen unless the code is wrong.
 */
export class ConsentInternalError extends ConsentError {
  override readonly category = "fault";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}
