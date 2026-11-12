import semver from "semver";

/** One dependency of a project: its package name and the specifier its `package.json` gives it. */
export class Dependency {
  /** The package name. */
  readonly name: string;
  /** The specifier, trimmed. */
  readonly specifier: string;

  /**
   * @param name - The package name.
   * @param specifier - The specifier, trimmed.
   */
  constructor(name: string, specifier: string) {
    this.name = name;
    this.specifier = specifier;
  }

  /** Whether the specifier is one exact version; a range, dist-tag or `file:` is a resolution choice. */
  get isExact(): boolean {
    return semver.valid(this.specifier) !== null;
  }

  /**
   * Whether this is an exact pin older than a version.
   *
   * @param version - The version to compare against.
   * @returns `false` for a floating specifier, which is never behind, and when `version` is not semver.
   */
  isBehind(version: string): boolean {
    return this.isExact && semver.valid(version) !== null && semver.lt(this.specifier, version);
  }

  /**
   * Whether this is an exact pin newer than a version.
   *
   * @param version - The version to compare against.
   * @returns `false` for a floating specifier, which is never ahead, and when `version` is not semver.
   */
  isAhead(version: string): boolean {
    return this.isExact && semver.valid(version) !== null && semver.gt(this.specifier, version);
  }
}
