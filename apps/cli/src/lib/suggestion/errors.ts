import { ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything the suggestion package fails with on purpose.
 */
export abstract class SuggestionError extends ZitadelLibError {}

/**
 * A suggested follow-up that cannot be rendered: it names a command, flag or
 * argument this CLI does not have, or combines them in a way the command
 * refuses. A defect in the suggestion, never in what the person typed.
 */
export class SuggestionInvalidError extends SuggestionError {
  override readonly category: ErrorCategory = "fault";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}
