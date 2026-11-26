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

  /** What named the environment (`--env`, `ZITADEL_ENV`), which the refusal says may not name it so. */
  readonly source: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param source - What named the environment.
   */
  constructor(message: string, source: string) {
    super(message);
    this.source = source;
  }
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

  /** The environment the value is missing from (`development`, `production`). */
  readonly environment: string;

  /** The value that is missing (`ZITADEL_PROJECT_ID`). */
  readonly variable: string;

  /** Every source the chain looked in, in the order it looked. */
  readonly consulted: readonly string[];

  /** The file to set the value in, beside the process environment. */
  readonly file: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param missing - The environment, the value, the sources consulted and the file to set it in.
   */
  constructor(
    message: string,
    missing: Readonly<{
      environment: string;
      variable: string;
      consulted: readonly string[];
      file: string;
    }>,
  ) {
    super(message);
    this.environment = missing.environment;
    this.variable = missing.variable;
    this.consulted = missing.consulted;
    this.file = missing.file;
  }
}

/**
 * A server address a source supplied is not a URL.
 */
export class EnvironmentValueInvalidError extends EnvironmentError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** Where the address came from, which the refusal says to fix it in. */
  readonly source: string;

  /** Why the address is not a server, which the refusal reports. */
  readonly reason: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param source - Where the address came from.
   * @param cause - The failure that reading the address raised.
   */
  constructor(message: string, source: string, cause: ZitadelLibError) {
    super(message, cause);
    this.source = source;
    this.reason = cause.message;
  }
}

/**
 * A value the command cannot run without is set in no source, and the
 * environment has no project at all, so there is nothing to add it to yet.
 */
export class EnvironmentValueUnboundError extends EnvironmentValueMissingError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}
