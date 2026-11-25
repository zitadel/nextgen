import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything the wizard engine fails with on purpose.
 *
 * @remarks
 * What a step throws is not one of these: it passes through as it was thrown,
 * after what had finished is undone.
 */
export abstract class WizardError extends Error {
  /** The kind of failure, which the boundary reports it as. */
  abstract readonly category: ErrorCategory;

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  abstract readonly retryable: boolean;

  /** The stable product code the failure is reported with. */
  abstract readonly code: ZitadelErrorCode;

  /**
   * Make a wizard failure.
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
 * The engine's own guard tripped: a wizard that is put together wrongly, such
 * as two steps of one name. It is a defect in the code that built the wizard,
 * not something a person can fix.
 */
export class WizardInternalError extends WizardError {
  override readonly category: ErrorCategory = "fault";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}
