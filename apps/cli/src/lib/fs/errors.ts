import { originalOf, ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Every error the file-system package throws.
 *
 * @remarks
 * A caller catches this to handle any file-system failure the package names,
 * or one of its subclasses to handle one condition. The message is what Node
 * said, which names the call and the path, and `cause` is Node's own error. A
 * failure with no class here is rethrown as Node raised it.
 */
export abstract class FsError extends ZitadelLibError {
  /** The errno Node failed with (`ENOENT`, `EACCES`), when it gave one. */
  readonly errno: string | undefined;

  /**
   * Make the failure.
   *
   * @param message - What Node said went wrong.
   * @param cause - Node's own error.
   * @param errno - The errno Node failed with, as `fsFailure` read it.
   */
  constructor(message: string, cause?: unknown, errno?: string) {
    super(message, cause);
    this.errno = errno;
  }

  /**
   * Node's own error, which the failure stands for.
   *
   * @returns Node's error, as `original`.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      original: originalOf(this),
    };
  }
}

/** Nothing exists at the path (`ENOENT`). */
export class FsNotFoundError extends FsError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string = "A required file or directory is missing.";
}

/** The process may not touch the path (`EACCES` or `EPERM`). */
export class FsDeniedError extends FsError {
  override readonly category: ErrorCategory = "denied";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_AUTH";
  override readonly hint: string = "Check file permissions or run with the right user.";
}

/** A file stands where a directory was needed (`ENOTDIR`). */
export class FsNotDirectoryError extends FsError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** A directory stands where a file was needed (`EISDIR`). */
export class FsIsDirectoryError extends FsError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** Something already exists at the path (`EEXIST`). */
export class FsExistsError extends FsError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
}

/**
 * Any other failure Node reported with an errno code (`ELOOP`, `ENAMETOOLONG`,
 * `EIO`, ...), so catching {@link FsError} catches every file-system failure.
 */
export class FsFailedError extends FsError {
  override readonly category: ErrorCategory = "unknown";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** The code Node reported, such as `ELOOP`, for a reason a report shows. */
  override readonly errno: string;

  /**
   * Make the failure.
   *
   * @param message - What Node said went wrong.
   * @param errno - The code Node reported.
   * @param cause - Node's own error.
   */
  constructor(message: string, errno: string, cause?: unknown) {
    super(message, cause, errno);
    this.errno = errno;
  }
}
