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
 * A connection's secret is written into its file instead of naming a variable.
 */
export class PublishConnectionSecretLiteralError extends PublishError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * A connection's client id and client secret name one variable.
 */
export class PublishConnectionVariableSharedError extends PublishError {
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

  /**
   * The variable the connection names.
   */
  readonly variable: string;

  /**
   * Whether the connection needs it to be a secret.
   */
  readonly secret: boolean;

  /**
   * Make the failure.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param variable - The variable the connection names.
   * @param secret - Whether the connection needs it to be a secret.
   */
  constructor(message: string, variable: string, secret: boolean) {
    super(message);
    this.variable = variable;
    this.secret = secret;
  }
}

/**
 * A connection names a variable that is a secret where it needs a plain one, or the reverse.
 */
export class PublishConnectionVariableKindError extends PublishError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The variable the connection names.
   */
  readonly variable: string;

  /**
   * Whether the connection needs it to be a secret.
   */
  readonly secret: boolean;

  /**
   * Make the failure.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param variable - The variable the connection names.
   * @param secret - Whether the connection needs it to be a secret.
   */
  constructor(message: string, variable: string, secret: boolean) {
    super(message);
    this.variable = variable;
    this.secret = secret;
  }
}

/**
 * A probed asset URL resolves to an address that is not public, so the probe does not send it a request.
 */
export class PublishAssetTargetUnsafeError extends PublishError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * A probed asset's host name could not be resolved, so the probe cannot reach it.
 */
export class PublishAssetLookupFailedError extends PublishError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = true;
  override readonly code: ZitadelErrorCode = "E_NETWORK";
}
