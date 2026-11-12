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
   * @param version - A version that may not be there.
   * @returns The release, or `undefined` without a version.
   */
  static from(version: string | undefined): Release | undefined {
    return version === undefined ? undefined : new Release(version);
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
