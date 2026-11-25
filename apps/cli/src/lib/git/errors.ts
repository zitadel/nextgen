import type { Categorized, ErrorCategory } from "@/lib/errors";

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
export class GitError extends Error implements Categorized {
  /** The kind of failure, which the boundary reports it as. */
  readonly category: ErrorCategory;

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  readonly retryable: boolean = false;

  /**
   * Creates the error.
   *
   * @param category - What kind of failure it is.
   * @param message - What went wrong.
   * @param options - The error that caused this one, if any.
   */
  constructor(
    category: ErrorCategory,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "GitError";
    this.category = category;
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
  override readonly retryable: boolean = false;
  /**
   * Creates the error.
   *
   * @param message - The message Node gave.
   */
  constructor(message: string) {
    super("invalid", message);
    this.name = "GitBinaryMissingError";
  }
}

/**
 * git ran and failed for a reason nothing here handles: it exited non-zero, was
 * killed, timed out, or printed more than the buffer holds.
 *
 * Carries git's own words and no advice, because nothing knows why.
 */
export class GitCommandFailedError extends GitError {
  override readonly retryable: boolean = false;
  /**
   * Creates the error.
   *
   * @param message - What git said, or what this package says when git said nothing.
   */
  constructor(message: string) {
    super("unknown", message);
    this.name = "GitCommandFailedError";
  }
}

/** A bug in this package: something that cannot happen unless the code is wrong. */
export class GitInternalError extends GitError {
  override readonly retryable: boolean = false;
  /**
   * Creates the error.
   *
   * @param message - What the code found impossible.
   */
  constructor(message: string) {
    super("fault", message);
    this.name = "GitInternalError";
  }
}
