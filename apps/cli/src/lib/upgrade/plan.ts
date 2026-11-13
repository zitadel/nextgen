import semver from "semver";

import type { Dependencies, Dependency } from "./dependencies";
import type { Release } from "./release";

/**
 * One package a plan moves.
 */
export type PackageUpgrade = Readonly<{
  /**
   * The package name.
   */
  name: string;

  /**
   * The exact version it is pinned to now.
   */
  from: string;

  /**
   * The version it moves to.
   */
  to: string;
}>;

/**
 * What an upgrade would change, decided before anything is touched, so a person
 * can read it, and stop, while nothing has happened yet.
 */
export class UpgradePlan {
  /**
   * The running tool's version.
   */
  readonly cliVersion: string;

  /**
   * The version the project moves to.
   */
  readonly target: string;

  /**
   * The packages the plan moves.
   */
  readonly packages: readonly PackageUpgrade[];

  /**
   * The dependencies the plan leaves as they are.
   */
  readonly leftAlone: readonly Dependency[];

  /**
   * @param cliVersion - The running tool's version.
   * @param target - The version the project moves to.
   * @param packages - The packages the plan moves.
   * @param leftAlone - The dependencies the plan leaves as they are.
   */
  private constructor(
    cliVersion: string,
    target: string,
    packages: readonly PackageUpgrade[],
    leftAlone: readonly Dependency[],
  ) {
    this.cliVersion = cliVersion;
    this.target = target;
    this.packages = packages;
    this.leftAlone = leftAlone;
  }

  /**
   * Decides what an upgrade to a release would change. A tool ahead of the
   * release (a prerelease) is what its own files target, so it is never moved
   * back: the target is the newer of the two.
   *
   * @param input.cliVersion - The running tool's version.
   * @param input.latest - What the registry answered.
   * @param input.dependencies - The project's dependencies, if it has any.
   * @returns The plan.
   */
  static create(input: {
    cliVersion: string;
    latest: Release;
    dependencies: Dependencies | undefined;
  }): UpgradePlan {
    const { cliVersion, latest, dependencies } = input;
    const target = latest.isNewerThan(cliVersion) ? latest.version : cliVersion;
    const behind = (dependencies?.exact() ?? []).filter((dependency) => {
      return dependency.isBehind(target);
    });
    const packages = behind.map((dependency) => {
      return {
        name: dependency.name,
        from: dependency.specifier,
        to: target,
      };
    });
    return new UpgradePlan(cliVersion, target, packages, dependencies?.floating() ?? []);
  }

  /**
   * The oldest version the upgrade starts from: the tool's own, or the oldest pin
   * that moves. Every breaking change after it is one the person crosses.
   *
   * @returns The version.
   */
  get oldest(): string {
    const versions = [this.cliVersion, ...this.packages.map((pkg) => pkg.from)].filter(
      (version) => {
        return semver.valid(version) !== null;
      },
    );
    return versions.sort(semver.compare)[0] ?? "0.0.0";
  }

  /**
   * Whether the running tool is itself older than the target.
   *
   * @returns `true` when a newer tool exists.
   */
  get cliBehind(): boolean {
    return this.target !== this.cliVersion;
  }

  /**
   * Whether there is nothing to move: the tool and every pin are at the target.
   *
   * @returns `true` when there is nothing to do.
   */
  get upToDate(): boolean {
    return !this.cliBehind && this.packages.length === 0;
  }

  /**
   * The `name@version` specs to hand the package manager.
   *
   * @returns One spec per package that moves.
   */
  get specs(): readonly string[] {
    return this.packages.map((pkg) => {
      return `${pkg.name}@${pkg.to}`;
    });
  }
}
