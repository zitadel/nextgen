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
 * What a wizard failure carries beyond its message.
 */
export type WizardErrorOptions = {
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
 * Anything the wizard engine fails with on purpose.
 *
 * @remarks
 * What a step throws is not one of these: it passes through as it was thrown,
 * after what had finished is undone.
 */
export class WizardError extends Error implements Categorized {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "WizardError";

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
   * Make a wizard failure.
   *
   * @param message - What went wrong.
   * @param options - What to do about it, the facts behind it, and its cause.
   */
  constructor(message: string, options: WizardErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.hint = options.hint;
    this.details = options.details;
  }
}

/**
 * The engine's own guard tripped: a wizard that is put together wrongly, such
 * as two steps of one name, or a run whose undo failed while it undid the
 * failure that stopped it (that failure is the cause). Either is a defect in
 * the code that built the wizard, not something a person can fix.
 */
export class WizardInternalError extends WizardError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "WizardInternalError";
  override readonly category: ErrorCategory = "fault";
  override readonly retryable: boolean = false;
}
