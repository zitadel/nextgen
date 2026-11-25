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
  readonly details: Readonly<Record<string, unknown>>;

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
    const reason = options.cause instanceof Error ? `: ${options.cause.message}` : "";

    super(`Cannot read ${path} as a package.json${reason}`, options);
    this.details = {
      path,
    };
    this.path = path;
  }
}

/**
 * A package manager command that could not start or did not succeed. The
 * reason lives in the package manager's own output, which nothing here
 * interprets, so this is the generic wrapper and carries no guidance.
 */
export class PmCommandFailedError extends PmError {
  override readonly category: ErrorCategory = "unknown";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

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
    this.exit = options.exit;
    this.signal = options.signal;
    this.output = options.output;
  }
}
