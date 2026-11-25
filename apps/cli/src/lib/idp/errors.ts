import { ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything choosing or describing an identity provider fails with on purpose.
 *
 * @remarks
 * Each subclass states its own category, retryable and code, and the message
 * carries the facts. A caller catches this to handle any of them, or a
 * subclass to handle one condition.
 */
export abstract class IdpError extends ZitadelLibError {}

/**
 * A setting of a custom connection that the platform refuses.
 */
export class IdpSettingRefusedError extends IdpError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * Settings that describe a custom connection, given with a catalog provider.
 */
export class IdpSettingsConflictError extends IdpError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * A custom connection that lacks settings it needs.
 */
export class IdpSettingsMissingError extends IdpError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * The provider named is neither one in the catalog nor a custom connection.
 */
export class IdpProviderUnknownError extends IdpError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}
