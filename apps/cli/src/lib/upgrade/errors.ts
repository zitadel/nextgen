/** The newest release could not be looked up. */
export class ReleaseLookupError extends Error {
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
   * @param message - What the package manager said.
   * @param command - The install, as the person's shell reads it.
   * @param cause - The failure itself.
   */
  constructor(message: string, command: string, cause: unknown) {
    super(message, { cause });
    this.name = "InstallError";
    this.command = command;
  }
}
