import type { Categorized, ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/** The code each kind of failure is reported with, unless a class's condition has one of its own. */
const CATEGORY_CODES = {
  invalid: "E_VALIDATION",
  missing: "E_NOT_FOUND",
  conflict: "E_CONFLICT",
  denied: "E_AUTH",
  unavailable: "E_NETWORK",
  fault: "E_VALIDATION",
  unknown: "E_VALIDATION",
} as const satisfies Record<ErrorCategory, ZitadelErrorCode>;

/**
 * What a package manager failure carries beyond its message.
 */
export type PmErrorOptions = {
  /**
   * What to do about it, in words that name no command or flag.
   */
  readonly hint?: string | undefined;

  /**
   * Structured facts about the failure, for a `--json` reader.
   */
  readonly details?: Readonly<Record<string, unknown>> | undefined;

  /**
   * The error that caused this one.
   */
  readonly cause?: unknown;
};

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
export class PmError extends Error implements Categorized {
  /** The kind of failure; a subclass states its own. */
  readonly category: ErrorCategory = "invalid";

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  readonly retryable: boolean = false;

  /**
   * The stable product code the failure is reported with, which is the one
   * its category has unless a class's condition has a code of its own.
   */
  get code(): ZitadelErrorCode {
    return CATEGORY_CODES[this.category];
  }

  /**
   * What to do about it.
   */
  readonly hint: string | undefined;

  /**
   * Structured facts about the failure, for a `--json` reader.
   */
  readonly details: Readonly<Record<string, unknown>> | undefined;

  /**
   * Make a package manager failure.
   *
   * @param message - What went wrong.
   * @param options - What to do about it, the facts behind it, and its cause.
   */
  constructor(message: string, options: PmErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.hint = options.hint;
    this.details = options.details;
  }
}

/**
 * A `package.json` that cannot be read as a manifest: it is not JSON, or its
 * root is not an object.
 */
export class PmManifestInvalidError extends PmError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;

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
  constructor(path: string, options: PmErrorOptions = {}) {
    const reason = options.cause instanceof Error ? `: ${options.cause.message}` : "";

    super(`Cannot read ${path} as a package.json${reason}`, {
      details: { path },
      ...options,
    });
    this.path = path;
  }
}

/**
 * What a failed package manager command leaves behind, for whoever reports it.
 */
export type PmCommandFailedOptions = PmErrorOptions & {
  /**
   * The errno string of a command that could not start, or the exit code of
   * one that ran and failed.
   */
  readonly exit?: string | number | undefined;

  /**
   * The signal that ended the command, when one did.
   */
  readonly signal?: string | null | undefined;

  /**
   * What the command printed, when its output was captured.
   */
  readonly output?: string | undefined;
};

/**
 * A package manager command that could not start or did not succeed. The
 * reason lives in the package manager's own output, which nothing here
 * interprets, so this is the generic wrapper and carries no guidance.
 */
export class PmCommandFailedError extends PmError {
  override readonly category: ErrorCategory = "unknown";
  override readonly retryable: boolean = false;

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
  constructor(message: string, options: PmCommandFailedOptions = {}) {
    super(message, options);
    this.exit = options.exit;
    this.signal = options.signal;
    this.output = options.output;
  }
}
