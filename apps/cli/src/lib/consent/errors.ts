import { ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";
import type { SuggestedCommand } from "@/lib/suggestion";

/**
 * Anything asking for consent fails with on purpose.
 *
 * @remarks
 * Each subclass states its own category, retryable and code, and the message
 * carries the facts. A caller catches this, or one of its subclasses.
 */
export abstract class ConsentError extends ZitadelLibError {}

/**
 * A bug in this package: something that cannot happen unless the code is wrong.
 */
export class ConsentInternalError extends ConsentError {
  override readonly category: ErrorCategory = "fault";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * A destructive action stopped for want of `--force` with nobody to ask. Only a
 * person can agree to it, so the command that catches this words the refusal.
 */
export class ConsentRequiredError extends ConsentError {
  override readonly category: ErrorCategory = "denied";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFIRMATION_REQUIRED";

  /** What a person would have been asked. */
  readonly question: string;

  /** The command that runs the action again with `--force`, when the gate names one. */
  readonly retry: SuggestedCommand | undefined;

  /**
   * Creates the error.
   *
   * @param message - What was stopped, naming the action.
   * @param question - What a person would have been asked.
   * @param retry - The command that runs the action again with `--force`, when there is one.
   */
  constructor(message: string, question: string, retry?: SuggestedCommand) {
    super(message);
    this.question = question;
    this.retry = retry;
  }
}
