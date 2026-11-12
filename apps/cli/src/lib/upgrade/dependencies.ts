import semver from "semver";

import { readPackageJsonIfExists } from "@/lib/npm";

/**
 * One dependency of a project: its package name and the specifier its
 * `package.json` gives it.
 */
export class Dependency {
  /**
   * The package name.
   */
  readonly name: string;

  /**
   * The specifier, trimmed.
   */
  readonly specifier: string;

  /**
   * @param name - The package name.
   * @param specifier - The specifier, trimmed.
   */
  constructor(name: string, specifier: string) {
    this.name = name;
    this.specifier = specifier;
  }

  /**
   * Whether the specifier is one exact version. A range, a dist-tag or a `file:`
   * specifier is a resolution choice the person made, so it is not an exact pin.
   *
   * @returns `true` for an exact pin.
   */
  get isExact(): boolean {
    return semver.valid(this.specifier) !== null;
  }

  /**
   * Whether this is an exact pin older than a version. A floating specifier is
   * never behind, and a version that is not semver, such as a development
   * build's placeholder, has nothing to be behind.
   *
   * @param version - The version to compare against.
   * @returns `false` for a floating specifier, and when `version` is not semver.
   */
  isBehind(version: string): boolean {
    if (!this.isExact || semver.valid(version) === null) {
      return false;
    }
    return semver.lt(this.specifier, version);
  }

  /**
   * Whether this is an exact pin newer than a version, under the same rules as
   * {@link Dependency.isBehind}.
   *
   * @param version - The version to compare against.
   * @returns `false` for a floating specifier, and when `version` is not semver.
   */
  isAhead(version: string): boolean {
    if (!this.isExact || semver.valid(version) === null) {
      return false;
    }
    return semver.gt(this.specifier, version);
  }
}

/**
 * The dependencies and dev dependencies of one project that belong to a package
 * scope, such as the packages of one product that move together.
 */
export class Dependencies {
  /**
   * Every dependency in scope, exact or not.
   */
  private readonly all: readonly Dependency[];

  /**
   * @param all - Every dependency in scope.
   */
  private constructor(all: readonly Dependency[]) {
    this.all = all;
  }

  /**
   * Reads the project's `package.json`.
   *
   * @param cwd - The project directory.
   * @param scope - The package name prefix to keep, such as `@acme/`.
   * @returns The dependencies, or `undefined` without a `package.json`.
   * @throws A `SyntaxError` when the `package.json` is not valid JSON.
   */
  static async read(cwd: string, scope: string): Promise<Dependencies | undefined> {
    const pkg = await readPackageJsonIfExists(cwd);
    if (pkg === undefined) {
      return undefined;
    }
    const entries = Object.entries({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    });
    const inScope = entries.filter(([name]) => {
      return name.startsWith(scope);
    });
    return new Dependencies(
      inScope.map(([name, specifier]) => {
        return new Dependency(name, (specifier ?? "").trim());
      }),
    );
  }

  /**
   * The dependencies pinned to an exact version. Ranges, dist-tags and `file:`
   * specifiers are left out: they express a resolution choice, not a release.
   *
   * @returns The exact pins.
   */
  exact(): readonly Dependency[] {
    return this.all.filter((dependency) => {
      return dependency.isExact;
    });
  }

  /**
   * The dependencies {@link Dependencies.exact} leaves out, which an upgrade
   * reports and never changes.
   *
   * @returns The floating dependencies.
   */
  floating(): readonly Dependency[] {
    return this.all.filter((dependency) => {
      return !dependency.isExact;
    });
  }
}
