/**
 * A git operation that failed, with a message ready to show the developer.
 *
 * What the module throws when git fails. The message is git's own (all of
 * its stderr, which often says how to fix the failure), or one of the
 * module's when git said nothing useful: output over 16 MB, a call that timed
 * out. The temporary staging area's file-system calls can still fail with
 * Node's own errors. Whether a failure is fatal is the caller's choice.
 */
export class RepositoryError extends Error {
  /** Creates the error from its message. */
  constructor(message: string) {
    super(message);
    this.name = "RepositoryError";
  }

  /**
   * The one line of the message that says why git failed, for a one-line warning; never empty.
   *
   * git writes `warning:` and `hint:` lines before and after the line that
   * gives the reason, so the first `fatal:` or `error:` line is taken, then
   * the first line, then a fixed phrase when git said nothing.
   */
  headline(): string {
    const lines = this.message
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    const reason = lines.find((line) => line.startsWith("fatal:") || line.startsWith("error:"));
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
export class GitDidNotStartError extends RepositoryError {
  /** Creates the error from the message Node gave. */
  constructor(message: string) {
    super(message);
    this.name = "GitDidNotStartError";
  }
}
