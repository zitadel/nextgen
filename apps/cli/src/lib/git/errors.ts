import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Every error the git package throws.
 *
 * @remarks
 * A caller catches this to handle anything from git, or one of its subclasses
 * to handle one condition. The message is git's own (all of its stderr, which
 * often says how to fix the failure), or one of the package's when git said
 * nothing useful. The temporary staging area's file-system calls can still
 * fail with Node's own errors. Whether a failure is fatal is the caller's choice.
 */
export abstract class GitError extends Error {
  /** The kind of failure, which the boundary reports it as. */
  abstract readonly category: ErrorCategory;

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  abstract readonly retryable: boolean;

  /** The stable product code the failure is reported with. */
  abstract readonly code: ZitadelErrorCode;

  /**
   * Creates the error.
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

  /**
   * The one line of the message that says why git failed, for a one-line warning; never empty.
   *
   * git writes `warning:` and `hint:` lines before and after the line that
   * gives the reason, so the first `fatal:` or `error:` line is taken, then
   * the first line, then a fixed phrase when git said nothing.
   *
   * @returns The line that says why.
   */
  headline(): string {
    const lines = this.message
      .split("\n")
      .map((line) => {
        return line.trim();
      })
      .filter((line) => {
        return line !== "";
      });
    const reason = lines.find((line) => {
      return line.startsWith("fatal:") || line.startsWith("error:");
    });
    if (reason !== undefined) {
      return reason;
    }

    return lines[0] ?? "git gave no reason";
  }
}

/**
 * git could not be started: there is none on `PATH`, or the directory to run it in does not exist.
 *
 * Its own type because callers treat it differently from git failing:
 * {@link Repository.open} answers "no repository" for it, where any other
 * failure is thrown.
 */
export class GitBinaryMissingError extends GitError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * git ran and failed for a reason nothing here handles: it exited non-zero, was
 * killed, timed out, or printed more than the buffer holds.
 *
 * Carries git's own words and no advice, because nothing knows why.
 */
export class GitCommandFailedError extends GitError {
  override readonly category: ErrorCategory = "unknown";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** A bug in this package: something that cannot happen unless the code is wrong. */
export class GitInternalError extends GitError {
  override readonly category: ErrorCategory = "fault";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}
