import { readPackageJsonIfExists } from "@/lib/npm";

import { Dependency } from "./dependency";

/** The dependencies and dev dependencies of one project that belong to a package scope. */
export class ScopedDependencies {
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
  static async read(cwd: string, scope: string): Promise<ScopedDependencies | undefined> {
    const pkg = await readPackageJsonIfExists(cwd);
    if (pkg === undefined) {
      return undefined;
    }
    return new ScopedDependencies(
      Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
        .filter(([name]) => {
          return name.startsWith(scope);
        })
        .map(([name, specifier]) => {
          return new Dependency(name, (specifier ?? "").trim());
        }),
    );
  }

  /**
   * The dependencies pinned to an exact version.
   *
   * @remarks
   * Ranges, dist-tags and `file:`/`workspace:` specifiers are left out: they
   * express a resolution choice, not a train.
   */
  exact(): readonly Dependency[] {
    return this.all.filter((dependency) => {
      return dependency.isExact;
    });
  }

  /** The dependencies {@link ScopedDependencies.exact} leaves out. */
  floating(): readonly Dependency[] {
    return this.all.filter((dependency) => {
      return !dependency.isExact;
    });
  }
}
