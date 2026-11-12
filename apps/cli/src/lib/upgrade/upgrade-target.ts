/**
 * What an upgrade is about: the package family it moves, the CLI package that
 * does the moving and the variable that switches the version check off.
 *
 * @remarks
 * The rest of `lib/upgrade` is written against this and names no product. It is
 * the one place that says what is being upgraded.
 */
export class UpgradeTarget {
  /** The prefix of the packages that move together. */
  readonly scope: string;
  /** The package whose dist-tag says what the newest release is. */
  readonly cliPackage: string;
  /** The environment variable that, set to `0`, keeps a run off the registry. */
  readonly updateCheckVariable: string;

  /**
   * @param scope - The prefix of the packages that move together, such as `@acme/`.
   * @param cliPackage - The package whose dist-tag says what the newest release is.
   * @param updateCheckVariable - The environment variable that, set to `0`, keeps a run off the registry.
   */
  constructor(scope: string, cliPackage: string, updateCheckVariable: string) {
    this.scope = scope;
    this.cliPackage = cliPackage;
    this.updateCheckVariable = updateCheckVariable;
  }

  /** The registry path of the CLI package's dist-tags, its scope escaped as npm itself escapes it. */
  get distTagsPath(): string {
    return `/-/package/${this.cliPackage.replace("/", "%2f")}/dist-tags`;
  }
}
