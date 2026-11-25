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
 * The configuration has errors, so nothing was sent.
 */
export class PublishConfigInvalidError extends PublishError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * The configuration has errors, one of them a key this CLI does not know, so nothing was sent.
 */
export class PublishConfigRefusedKeyError extends PublishError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * The configuration has errors, one of them a secret written into a file, so nothing was sent.
 */
export class PublishConfigLiteralSecretError extends PublishError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * The configuration has errors, one a secret written into a file and one a key this CLI does not know, so nothing was sent.
 */
export class PublishConfigLiteralSecretRefusedKeyError extends PublishError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * One variable named for both the client id and the client secret of a connection.
 */
export class PublishConnectionVariableSharedError extends PublishError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * A connection names a plain variable where its client secret needs a secret one.
 */
export class PublishConnectionVariableNotSecretError extends PublishError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The variable the connection names.
   */
  readonly variable: string;

  /**
   * Make the failure.
   *
   * @param message - What went wrong.
   * @param variable - The variable the connection names.
   */
  constructor(message: string, variable: string) {
    super(message);
    this.variable = variable;
  }
}

/**
 * A connection names a secret variable where its client id needs a plain one.
 */
export class PublishConnectionVariableNotPlainError extends PublishError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The variable the connection names.
   */
  readonly variable: string;

  /**
   * Make the failure.
   *
   * @param message - What went wrong.
   * @param variable - The variable the connection names.
   */
  constructor(message: string, variable: string) {
    super(message);
    this.variable = variable;
  }
}

/**
 * A connection names a variable for its client id that the project does not have.
 */
export class PublishConnectionVariableClientIdMissingError extends PublishError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CREDENTIAL_MISSING";

  /**
   * The variable the connection names.
   */
  readonly variable: string;

  /**
   * Make the failure.
   *
   * @param message - What went wrong.
   * @param variable - The variable the connection names.
   */
  constructor(message: string, variable: string) {
    super(message);
    this.variable = variable;
  }
}

/**
 * A connection names a variable for its client secret that the project does not have.
 */
export class PublishConnectionVariableClientSecretMissingError extends PublishError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CREDENTIAL_MISSING";

  /**
   * The variable the connection names.
   */
  readonly variable: string;

  /**
   * Make the failure.
   *
   * @param message - What went wrong.
   * @param variable - The variable the connection names.
   */
  constructor(message: string, variable: string) {
    super(message);
    this.variable = variable;
  }
}
