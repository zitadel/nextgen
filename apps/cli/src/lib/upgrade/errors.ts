import {
  categoryCode,
  type Categorized,
  type ErrorCategory,
  type ZitadelErrorCode,
} from "@/lib/errors";
import type { PackageCommand } from "@/lib/pm";

/**
 * What an upgrade failure carries beyond its message.
 */
export type UpgradeErrorOptions = {
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
 * Anything planning or applying an upgrade fails with on purpose.
 *
 * @remarks
 * A caller catches this, or one of its subclasses, and words the failure for
 * its own person. A failure nothing here anticipated bubbles as it was thrown.
 */
export class UpgradeError extends Error implements Categorized {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "UpgradeError";

  /** The kind of failure; a subclass states its own. */
  readonly category: ErrorCategory = "invalid";

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  readonly retryable: boolean = false;

  /**
   * The stable product code the failure is reported with, which is the one
   * its category has unless a class's condition has a code of its own.
   */
  get code(): ZitadelErrorCode {
    return categoryCode(this.category);
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
   * Make an upgrade failure.
   *
   * @param message - What went wrong.
   * @param options - What to do about it, the facts behind it, and its cause.
   */
  constructor(message: string, options: UpgradeErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.hint = options.hint;
    this.details = options.details;
  }
}

/**
 * The newest release could not be looked up. Its message is generic on purpose:
 * a caller words the failure for its own person, with its own suggestions.
 */
export class UpgradeReleaseLookupError extends UpgradeError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "UpgradeReleaseLookupError";
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = true;

  /**
   * Make the failure.
   *
   * @param options - What was known about why, and the cause.
   */
  constructor(options: UpgradeErrorOptions = {}) {
    super("Could not look up the latest release", options);
  }
}

/**
 * The package manager failed to install the new packages. It carries the install
 * and the failure, and nothing about how either is worded, so a caller words the
 * failure for its own person.
 */
export class UpgradeInstallFailedError extends UpgradeError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "UpgradeInstallFailedError";
  override readonly category: ErrorCategory = "unknown";
  override readonly retryable: boolean = false;

  /**
   * The install, as the person's shell reads it, so it can be offered again.
   */
  readonly command: PackageCommand;

  /**
   * Make the failure.
   *
   * @param command - The install, as the person's shell reads it.
   * @param cause - What the package manager failed with.
   */
  constructor(command: PackageCommand, cause: unknown) {
    super("Could not install the new packages", { cause });
    this.command = command;
  }
}
