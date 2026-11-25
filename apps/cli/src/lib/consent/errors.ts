import type { Categorized, ErrorCategory, ZitadelErrorCode } from "@/lib/errors";
import type { SuggestedCommand } from "@/lib/suggestion";

/** The code each kind of failure is reported with, unless a class's condition has one of its own. */
const CATEGORY_CODES = {
  invalid: "E_VALIDATION",
  missing: "E_NOT_FOUND",
  conflict: "E_CONFLICT",
  denied: "E_AUTH",
  unavailable: "E_NETWORK",
  fault: "E_VALIDATION",
  unknown: "E_VALIDATION",
} as const satisfies Record<ErrorCategory, ZitadelErrorCode>;

/**
 * What a consent failure carries beyond its message.
 */
export type ConsentErrorOptions = {
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
 * Anything asking for consent fails with on purpose.
 *
 * @remarks
 * A caller catches this, or one of its subclasses; the CLI turns it into its
 * own error in one place.
 */
export class ConsentError extends Error implements Categorized {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "ConsentError";

  /** The kind of failure; a subclass states its own. */
  readonly category: ErrorCategory = "conflict";

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  readonly retryable: boolean = false;

  /**
   * The stable product code the failure is reported with, which is the one
   * its category has unless a class's condition has a code of its own.
   */
  get code(): ZitadelErrorCode {
    return CATEGORY_CODES[this.category];
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
   * Make a consent failure.
   *
   * @param message - What went wrong.
   * @param options - What to do about it, the facts behind it, and its cause.
   */
  constructor(message: string, options: ConsentErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.hint = options.hint;
    this.details = options.details;
  }
}

/**
 * Nobody can be asked and consent was not given in advance, so the action is
 * refused: only a person may agree to it.
 */
export class ConsentRequiredError extends ConsentError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "ConsentRequiredError";
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;

  /** The stable product code the failure is reported with. */
  override get code(): ZitadelErrorCode {
    return "E_CONFIRMATION_REQUIRED";
  }

  /**
   * The question a person would have been asked.
   */
  readonly question: string;

  /**
   * The command again with consent given, for an agent to run once a person
   * agrees.
   */
  readonly retry: SuggestedCommand | undefined;

  /**
   * Make the failure.
   *
   * @param action - The action as a lowercase phrase.
   * @param question - The question a person would have been asked.
   * @param retry - The command again with consent given, when there is one.
   */
  constructor(action: string, question: string, retry?: SuggestedCommand) {
    super(`Cannot ${action} without --force in non-interactive mode`, {
      details: { question },
    });
    this.question = question;
    this.retry = retry;
  }
}

/**
 * A bug in this package: something that cannot happen unless the code is wrong.
 */
export class ConsentInternalError extends ConsentError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "ConsentInternalError";
  override readonly category: ErrorCategory = "fault";
  override readonly retryable: boolean = false;
}
