import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything reading or writing a project's files fails with on purpose.
 *
 * @remarks
 * A caller catches this, or one of its subclasses, and words the failure for
 * its own person. A failure nothing here anticipated, such as the operating
 * system refusing to read a file, is not one of these: it bubbles as it was
 * thrown.
 */
export abstract class ProjectError extends Error {
  /** The kind of failure, which the boundary reports it as. */
  abstract readonly category: ErrorCategory;

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  abstract readonly retryable: boolean;

  /** The stable product code the failure is reported with. */
  abstract readonly code: ZitadelErrorCode;

  /** What to do about it, for whoever reads the failure; none when there is nothing to add. */
  readonly hint?: string | undefined;

  /** Structured facts about the failure, for a `--json` reader. */
  readonly details?: Readonly<Record<string, unknown>> | undefined;

  /**
   * Make a project failure.
   *
   * @param message - What went wrong.
   * @param options - The error that caused this one, if any.
   */
  constructor(
    message: string,
    options: {
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * `zitadel.json` is not there: the directory is not a project that was set up.
 */
export class ProjectConfigMissingError extends ProjectError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * What to do about it.
   */
  override readonly hint: string = "Set the project up first.";

  /**
   * Make the failure.
   *
   * @param options - The error that caused this one, if any.
   */
  constructor(
    options: {
      readonly cause?: unknown;
    } = {},
  ) {
    super("zitadel.json was not found", options);
  }
}

/**
 * `.zitadel/secret` is not there.
 */
export class ProjectSecretMissingError extends ProjectError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * What to do about it.
   */
  override readonly hint: string =
    "The project secret can be restored from .env.development.local.";

  /**
   * Make the failure.
   *
   * @param options - The error that caused this one, if any.
   */
  constructor(
    options: {
      readonly cause?: unknown;
    } = {},
  ) {
    super(".zitadel/secret was not found", options);
  }
}

/**
 * `zitadel.json` cannot be read as what it should be: it is not JSON or not an object.
 */
export class ProjectConfigMalformedError extends ProjectError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * Make the failure.
   *
   * @param message - What went wrong.
   * @param options - The error that caused this one, if any.
   */
  constructor(
    message: string,
    options: {
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, options);
  }
}

/**
 * `.zitadel/secret` cannot be read as what it should be: it is not JSON, not an object, or lacks what it must hold.
 */
export class ProjectSecretMalformedError extends ProjectError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * Make the failure.
   *
   * @param message - What went wrong.
   * @param options - The error that caused this one, if any.
   */
  constructor(
    message: string,
    options: {
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, options);
  }
}

/**
 * A value with a line break, which a `.env` file cannot hold, so it is not written.
 */
export class ProjectEnvValueMultilineError extends ProjectError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * What to do about it.
   */
  override readonly hint: string =
    "A .env value is a single line; remove the newline or store the value another way.";

  /**
   * The variable whose value it is.
   */
  readonly key: string;

  /**
   * Make the failure.
   *
   * @param key - The variable whose value it is.
   */
  constructor(key: string) {
    super(`Cannot persist ${key}: its value contains a line break.`);
    this.key = key;
  }
}

/**
 * A value that no `.env` quoting reads back unchanged, so it is not written.
 */
export class ProjectEnvValueUnquotableError extends ProjectError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * What to do about it.
   */
  override readonly hint: string = "Set it in the process environment instead of a .env file.";

  /**
   * The variable whose value it is.
   */
  readonly key: string;

  /**
   * Make the failure.
   *
   * @param key - The variable whose value it is.
   */
  constructor(key: string) {
    super(`Cannot persist ${key}: no .env quoting reads its value back unchanged.`);
    this.key = key;
  }
}
