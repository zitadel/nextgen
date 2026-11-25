import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything reading a project's manifest or running its package manager fails
 * with on purpose.
 *
 * @remarks
 * A caller catches this, or one of its subclasses; the CLI turns it into its
 * own error in one place. A failure nothing here anticipated, such as the
 * operating system refusing to read the file, is not one of these: it bubbles
 * as it was thrown.
 */
export abstract class PmError extends Error {
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
   * Make a package manager failure.
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
 * A `package.json` that cannot be read as a manifest: it is not JSON, or its
 * root is not an object.
 */
export class PmManifestInvalidError extends PmError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * Structured facts about the failure, for a `--json` reader.
   */
  override readonly details: Readonly<Record<string, unknown>>;

  /**
   * The path of the file that was read.
   */
  readonly path: string;

  /**
   * Make the failure.
   *
   * @param path - The path of the file that was read.
   * @param options - The cause, which says what is wrong with the file.
   */
  constructor(
    path: string,
    options: {
      readonly cause?: unknown;
    } = {},
  ) {
    const message =
      options.cause instanceof Error
        ? options.cause.message
        : `Cannot read ${path} as a package.json`;
    super(message, options);
    this.details = {
      original: {
        name: options.cause instanceof Error ? options.cause.name : "Error",
        message,
      },
    };
    this.path = path;
  }
}

/**
 * A package manager command that did not succeed, or could not start for a
 * reason nothing here interprets. The reason lives in the package manager's
 * own output, so this is the generic wrapper and carries no guidance.
 */
export class PmCommandFailedError extends PmError {
  override readonly category: ErrorCategory = "unknown";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * Structured facts about the failure, for a `--json` reader.
   */
  override readonly details: Readonly<Record<string, unknown>>;

  /**
   * The errno string or the exit code.
   */
  readonly exit: string | number | undefined;

  /**
   * The signal that ended the command, when one did.
   */
  readonly signal: string | null | undefined;

  /**
   * What the command printed, when its output was captured.
   */
  readonly output: string | undefined;

  /**
   * Make the failure.
   *
   * @param message - What went wrong.
   * @param options - The exit, signal, captured output and cause.
   */
  constructor(
    message: string,
    options: {
      readonly exit?: string | number | undefined;
      readonly signal?: string | null | undefined;
      readonly output?: string | undefined;
      readonly cause?: unknown;
    } = {},
  ) {
    super(
      message,
      options.cause === undefined
        ? undefined
        : {
            cause: options.cause,
          },
    );
    this.details = {
      original: {
        name: "Error",
        message,
        code: options.exit,
      },
    };
    this.exit = options.exit;
    this.signal = options.signal;
    this.output = options.output;
  }
}

/**
 * A package manager command that could not start because the program or its
 * directory is not there.
 */
export class PmCommandNotStartedError extends PmError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * What to do about it.
   */
  override readonly hint: string = "A required file or directory is missing.";

  /**
   * Structured facts about the failure, for a `--json` reader.
   */
  override readonly details: Readonly<Record<string, unknown>>;

  /**
   * The errno string the operating system gave.
   */
  readonly exit: string;

  /**
   * Make the failure.
   *
   * @param message - What the operating system said.
   * @param exit - The errno string the operating system gave.
   */
  constructor(message: string, exit: string) {
    super(message);
    this.details = {
      original: {
        name: "Error",
        message,
        code: exit,
      },
    };
    this.exit = exit;
  }
}

/**
 * A package manager command that could not start because the operating system
 * refused to run it.
 */
export class PmCommandNotPermittedError extends PmError {
  override readonly category: ErrorCategory = "denied";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_AUTH";

  /**
   * What to do about it.
   */
  override readonly hint: string = "Check file permissions or run with the right user.";

  /**
   * Structured facts about the failure, for a `--json` reader.
   */
  override readonly details: Readonly<Record<string, unknown>>;

  /**
   * The errno string the operating system gave.
   */
  readonly exit: string;

  /**
   * Make the failure.
   *
   * @param message - What the operating system said.
   * @param exit - The errno string the operating system gave.
   */
  constructor(message: string, exit: string) {
    super(`Permission denied: ${message}`);
    this.details = {
      original: {
        name: "Error",
        message,
        code: exit,
      },
    };
    this.exit = exit;
  }
}
