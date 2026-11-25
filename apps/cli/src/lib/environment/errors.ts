import { ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything resolving an environment fails with on purpose.
 *
 * @remarks
 * Each subclass states its own category, retryable and code, and the message
 * carries the facts. A caller catches this to handle any of them, or a
 * subclass to handle one condition. A failure nothing here anticipated is not
 * one of these: it bubbles as it was thrown.
 */
export abstract class EnvironmentError extends ZitadelLibError {}

/**
 * An environment named by its name and by a file as well.
 */
export class EnvironmentSourcesConflictError extends EnvironmentError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * An environment name that cannot be used in a path.
 */
export class EnvironmentNameInvalidError extends EnvironmentError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * A server address a source supplied that is not a URL.
 */
export class EnvironmentServerInvalidError extends EnvironmentError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * The file an environment was told to read does not exist.
 */
export class EnvironmentFileMissingError extends EnvironmentError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * A value the command cannot run without is set in no source.
 */
export class EnvironmentValueMissingError extends EnvironmentError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * A value the command cannot run without is set in no source, and the
 * environment has no project at all, so there is nothing to add it to yet.
 */
export class EnvironmentValueUnboundError extends EnvironmentError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}
