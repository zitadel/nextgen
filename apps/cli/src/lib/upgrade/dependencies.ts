import semver from "semver";

import { readPackageJsonIfExists } from "@/lib/npm";

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

/** The dependencies and dev dependencies of one project that belong to a package scope. */
export class Dependencies {
  /** Every dependency in scope, exact or not. */
  private readonly all: readonly Dependency[];

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
    return new Dependencies(
      Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
        .filter(([name]) => {
          return name.startsWith(scope);
        })
        .map(([name, specifier]) => {
          return new Dependency(name, (specifier ?? "").trim());
        }),
    );
  }

  /** The dependencies pinned to an exact version; ranges, dist-tags and `file:` are a resolution choice. */
  exact(): readonly Dependency[] {
    return this.all.filter((dependency) => {
      return dependency.isExact;
    });
  }

  /** The dependencies {@link Dependencies.exact} leaves out. */
  floating(): readonly Dependency[] {
    return this.all.filter((dependency) => {
      return !dependency.isExact;
    });
  }
}
