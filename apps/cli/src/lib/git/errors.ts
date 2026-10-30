/**
 * A git operation that failed, with a message ready to show the developer.
 *
 * The only error the module throws, so a caller catches one type. The message
 * is git's own (all of its stderr, which often says how to fix the failure),
 * or one of the module's when git said nothing useful: output over 16 MB, a
 * call that timed out. Whether a failure is fatal is the caller's choice; a
 * release, for one, records null and carries on.
 */
export class RepositoryError extends Error {
  /** Creates the error from its message. */
  constructor(message: string) {
    super(message);
    this.name = "RepositoryError";
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
