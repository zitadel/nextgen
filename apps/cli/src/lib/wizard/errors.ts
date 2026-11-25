import { codeOf } from "@/lib/errors";
import type { Categorized, ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

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
  /** The kind of failure; a subclass states its own. */
  readonly category: ErrorCategory = "fault";

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  readonly retryable: boolean = false;

  /**
   * The stable product code the failure is reported with, which is the one
   * its category has unless a class's condition has a code of its own.
   */
  get code(): ZitadelErrorCode {
    return codeOf(this.category);
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
    this.name = new.target.name;
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
  override readonly category: ErrorCategory = "fault";
  override readonly retryable: boolean = false;
}
