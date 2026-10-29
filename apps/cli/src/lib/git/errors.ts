/** A git operation that failed, with a message ready to show the developer. */
export class RepositoryError extends Error {
  /** Creates the error from its message. */
  constructor(message: string) {
    super(message);
    this.name = "RepositoryError";
  }
}

/** git could not be started: there is none on `PATH`, or the directory to run it in does not exist. */
export class GitDidNotStartError extends RepositoryError {
  /** Creates the error from the message Node gave. */
  constructor(message: string) {
    super(message);
    this.name = "GitDidNotStartError";
  }
}
