import { ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything publishing a configuration refuses with on purpose.
 *
 * @remarks
 * Each subclass states its own category, retryable and code, and the message
 * carries the facts. A caller catches this to handle any of them, or a
 * subclass to handle one condition. A failure nothing here anticipated is not
 * one of these: it bubbles as it was thrown.
 */
export abstract class PublishError extends ZitadelLibError {}

/**
 * The configuration has errors, or a connection names variables that cannot serve it, so nothing was sent.
 */
export class PublishConfigInvalidError extends PublishError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * A connection names a variable the project does not have.
 */
export class PublishConnectionVariableMissingError extends PublishError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CREDENTIAL_MISSING";
}

/**
 * A probed asset URL resolves to an address that is not public, so the probe does not send it a request.
 */
export class PublishAssetTargetUnsafeError extends PublishError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}
