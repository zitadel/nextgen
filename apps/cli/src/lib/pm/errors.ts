import { originalOf, ZitadelLibError } from "@/lib/errors";
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
export abstract class PmError extends ZitadelLibError {}

/**
 * A `package.json` that cannot be read as a manifest: it is not JSON, or its
 * root is not an object.
 */
export class PmManifestInvalidError extends PmError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The error the manifest could not be read with.
   *
   * @returns It, as `original`.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      original: originalOf(this),
    };
  }
}

/**
 * A package manager command that did not succeed, or could not start for a
 * reason nothing here interprets. The reason lives in the package manager's
 * own output, so this is the generic wrapper.
 */
export class PmCommandFailedError extends PmError {
  override readonly category: ErrorCategory = "unknown";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * How it failed, as the system said it: the errno it could not start with
   * (`ENOENT` for a package manager that is not installed), or the exit code
   * or signal it ended with.
   */
  readonly status: string | number;

  /**
   * What the command printed, when its output was captured.
   */
  readonly output: string | undefined;

  /**
   * Make the failure.
   *
   * @param message - What went wrong.
   * @param status - The errno it could not start with, or the exit code or signal it ended with.
   * @param output - What the command printed, when its output was captured.
   */
  constructor(message: string, status: string | number, output?: string) {
    super(message);
    this.status = status;
    this.output = output;
  }

  /**
   * The command's failure, and the errno or exit status it ended with.
   *
   * @returns It, as `original`.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      original: {
        name: this.name,
        message: this.message,
        code: this.status,
      },
    };
  }
}

/**
 * A package manager command that could not start because the operating system
 * refused to run it. Its `status` is the errno it was refused with (`EACCES`, `EPERM`).
 */
export class PmCommandNotPermittedError extends PmCommandFailedError {
  override readonly category: ErrorCategory = "denied";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_AUTH";
  override readonly hint: string = "Check file permissions or run with the right user.";

  /** What the operating system said when it refused to run the command. */
  readonly refusal: string;

  /**
   * Make the failure.
   *
   * @param refusal - What the operating system said when it refused to run the command.
   * @param status - The errno it was refused with.
   */
  constructor(refusal: string, status: string) {
    super(`Permission denied: ${refusal}`, status);
    this.refusal = refusal;
  }

  /**
   * The refusal, and the errno it came with.
   *
   * @returns It, as `original`.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      original: {
        name: this.name,
        message: this.refusal,
        code: this.status,
      },
    };
  }
}

/**
 * A package manager command that could not start because the program it runs
 * is not there. Its `status` is the errno it was refused with (`ENOENT`).
 */
export class PmCommandMissingError extends PmCommandFailedError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string = "A required file or directory is missing.";
}
