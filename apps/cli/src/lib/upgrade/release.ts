import semver from "semver";

/** One published release of the CLI package. */
export class Release {
  /** The release's version, which the registry or the cache vouched is semver. */
  readonly version: string;

  /**
   * @param version - The release's version.
   */
  constructor(version: string) {
    this.version = version;
  }

  /**
   * @param version - A value that may not be a version: an answer from outside.
   * @returns The release, or `undefined` when it is not semver.
   */
  static from(version: unknown): Release | undefined {
    return typeof version === "string" && semver.valid(version) !== null
      ? new Release(version)
      : undefined;
  }

  /**
   * Whether this release is newer than a version.
   *
   * @param version - What it is compared with.
   * @returns `false` when that is not semver.
   */
  isNewerThan(version: string): boolean {
    return semver.valid(version) !== null && semver.gt(this.version, version);
  }
}
