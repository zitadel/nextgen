import { ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

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
