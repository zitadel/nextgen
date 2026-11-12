/**
 * What an upgrade is about: the package family it moves and the package whose
 * dist-tag says what the newest release is.
 */
export class UpgradeTarget {
  /** The prefix of the packages that move together, such as `@acme/`. */
  readonly scope: string;

  /** The package whose dist-tag says what the newest release is, such as `@acme/cli`. */
  readonly packageName: string;

  /**
   * @param scope - The prefix of the packages that move together.
   * @param packageName - The package whose dist-tag names the newest release.
   */
  constructor(scope: string, packageName: string) {
    this.scope = scope;
    this.packageName = packageName;
  }

  /** The registry path of the package's dist-tags, its scope escaped as npm itself escapes it. */
  get distTagsPath(): string {
    return `/-/package/${this.packageName.replace("/", "%2f")}/dist-tags`;
  }
}
