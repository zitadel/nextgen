/**
 * The newest release could not be looked up. Its message is generic on purpose:
 * a caller words the failure for its own person, with its own suggestions.
 */
export class ReleaseLookupError extends Error {
  /**
   * Takes no arguments: there is nothing to say beyond the fact that the lookup
   * found no release.
   */
  constructor() {
    super("Could not look up the latest release");
    this.name = "ReleaseLookupError";
  }
}

/**
 * The package manager failed to install the new packages. It carries the install
 * and the failure, and nothing about how either is worded, so a caller words the
 * failure for its own person.
 */
export class InstallError extends Error {
  /**
   * The install, as the person's shell reads it, so it can be offered again.
   */
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
