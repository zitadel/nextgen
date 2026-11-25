import { ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything the wizard engine fails with on purpose.
 *
 * @remarks
 * What a step throws is not one of these: it passes through as it was thrown,
 * after what had finished is undone.
 */
export abstract class WizardError extends ZitadelLibError {}

/**
 * Refuses a wizard that is put together wrongly, such as two steps of one name.
 */
export class WizardDefinitionError extends WizardError {
  override readonly category: ErrorCategory = "fault";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}
