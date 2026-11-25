import { ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";
import type { PackageCommand } from "@/lib/pm";

/**
 * Anything planning or applying an upgrade fails with on purpose.
 *
 * @remarks
 * A caller catches this, or one of its subclasses, and words the failure for
 * its own person. A failure nothing here anticipated bubbles as it was thrown.
 */
export abstract class UpgradeError extends ZitadelLibError {}

/**
 * The newest release could not be looked up. Its message is generic on purpose:
 * a caller words the failure for its own person, with its own suggestions.
 */
export class UpgradeReleaseLookupError extends UpgradeError {
  override readonly category: ErrorCategory = "unknown";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
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
    super("Could not install the new packages", cause);
    this.command = command;
  }
}
