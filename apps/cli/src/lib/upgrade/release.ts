import semver from "semver";

/**
 * One published release of a package: a version that is known to be semver, so a
 * comparison against it never has to guess.
 */
export class Release {
  /**
   * The release's version.
   */
  readonly version: string;

  /**
   * @param version - The release's version, already known to be semver.
   */
  constructor(version: string) {
    this.version = version;
  }

  /**
   * Makes a release out of an answer from outside, such as a registry response or
   * a cache file, where nothing guarantees the value is a version.
   *
   * @param version - A value that may not be a version.
   * @returns The release, or `undefined` when the value is not semver.
   */
  static from(version: unknown): Release | undefined {
    if (typeof version !== "string" || semver.valid(version) === null) {
      return undefined;
    }
    return new Release(version);
  }

  /**
   * Whether this release is newer than a version. A version that is not semver,
   * such as a development build's placeholder, is never older than anything.
   *
   * @param version - What this release is compared with.
   * @returns `false` when that version is not semver.
   */
  isNewerThan(version: string): boolean {
    if (semver.valid(version) === null) {
      return false;
    }
    return semver.gt(this.version, version);
  }
}
