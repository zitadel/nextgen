/** The newest release could not be looked up. */
export class ReleaseLookupError extends Error {
  /**
   * The message is generic on purpose: a caller words the failure for its own
   * person, as the Zitadel upgrader does when it turns this into a `ZitadelError`.
   */
  constructor() {
    super("Could not look up the latest release");
    this.name = "ReleaseLookupError";
  }
}

/** The package manager failed to install the new packages. */
export class InstallError extends Error {
  /** The install, as the person's shell reads it, so it can be rerun. */
  readonly command: string;

  /**
   * @param command - The install, as the person's shell reads it.
   * @param cause - What the package manager failed with.
   */
  constructor(command: string, cause: unknown) {
    super("Could not install the new packages", { cause });
    this.name = "InstallError";
    this.command = command;
  }
}
