import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";
import type { PackageCommand } from "@/lib/pm";

/**
 * Anything planning or applying an upgrade fails with on purpose.
 *
 * @remarks
 * A caller catches this, or one of its subclasses, and words the failure for
 * its own person. A failure nothing here anticipated bubbles as it was thrown.
 */
export abstract class UpgradeError extends Error {
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
   * Make an upgrade failure.
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
 * The newest release could not be looked up. Its message is generic on purpose:
 * a caller words the failure for its own person, with its own suggestions.
 */
export class UpgradeReleaseLookupError extends UpgradeError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = true;
  override readonly code: ZitadelErrorCode = "E_NETWORK";

  /**
   * Takes no arguments: there is nothing to say beyond the fact that the lookup
   * found no release.
   */
  constructor() {
    super("Could not look up the latest release");
  }
}

/**
 * The package manager failed to install the new packages. It carries the install
 * and the failure, and nothing about how either is worded, so a caller words the
 * failure for its own person.
 */
export class UpgradeInstallFailedError extends UpgradeError {
  override readonly category: ErrorCategory = "unknown";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The install, as the person's shell reads it, so it can be offered again.
   */
  readonly command: PackageCommand;

  /**
   * @param command - The install, as the person's shell reads it.
   * @param cause - What the package manager failed with.
   */
  constructor(command: PackageCommand, cause: unknown) {
    super("Could not install the new packages", {
      cause,
    });
    this.command = command;
  }
}
