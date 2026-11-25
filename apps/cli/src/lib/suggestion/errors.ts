import type { Categorized, ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

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
 * What a suggestion failure carries beyond its message.
 */
export type SuggestionErrorOptions = {
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
 * Anything the suggestion renderer fails with on purpose.
 *
 * @remarks
 * Every one is a guard on a suggestion that CLI code built wrongly: a person
 * never types a suggestion, so none is the person's to fix.
 */
export class SuggestionError extends Error implements Categorized {
  /** The kind of failure; a subclass states its own. */
  readonly category: ErrorCategory = "fault";

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
   * Make a suggestion failure.
   *
   * @param message - What went wrong.
   * @param options - What to do about it, the facts behind it, and its cause.
   */
  constructor(message: string, options: SuggestionErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.hint = options.hint;
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
}
