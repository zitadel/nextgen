import semver from "semver";

import type { Dependencies, Dependency } from "./dependencies";
import type { Release } from "./release";

/** One package a plan moves. */
export type PackageUpgrade = Readonly<{ name: string; from: string; to: string }>;

/** What an upgrade would change, decided before anything is touched. */
export class UpgradePlan {
  /** The running CLI's version. */
  readonly cliVersion: string;
  /** The version the project moves to. */
  readonly target: string;
  /** The packages the plan moves. */
  readonly packages: readonly PackageUpgrade[];
  /** The dependencies the plan leaves as they are. */
  readonly leftAlone: readonly Dependency[];

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
   * @param input.cliVersion - The running CLI's version.
   * @param input.latest - What the registry answered. A CLI ahead of it (a
   * prerelease) is what its own files target, so it is never moved back.
   * @param input.dependencies - The project's dependencies.
   */
  static create(input: {
    cliVersion: string;
    latest: Release;
    dependencies: Dependencies | undefined;
  }): UpgradePlan {
    const { cliVersion, latest, dependencies } = input;
    const target = latest.isNewerThan(cliVersion) ? latest.version : cliVersion;
    const packages = (dependencies?.exact() ?? [])
      .filter((dependency) => {
        return dependency.isBehind(target);
      })
      .map((dependency) => {
        return {
          name: dependency.name,
          from: dependency.specifier,
          to: target,
        };
      });
    return new UpgradePlan(cliVersion, target, packages, dependencies?.floating() ?? []);
  }

  /** The oldest version the upgrade starts from: the CLI's, or the oldest pin. */
  get oldest(): string {
    const versions = [this.cliVersion, ...this.packages.map((pkg) => pkg.from)];
    return [...versions].sort(semver.compare)[0] ?? "0.0.0";
  }

  /** Whether this CLI is itself older than the target. */
  get cliBehind(): boolean {
    return this.target !== this.cliVersion;
  }

  /** Whether there is nothing to move: the CLI and every pin are at the target. */
  get upToDate(): boolean {
    return !this.cliBehind && this.packages.length === 0;
  }

  /** The `name@version` specs to hand the package manager. */
  get specs(): readonly string[] {
    return this.packages.map((pkg) => {
      return `${pkg.name}@${pkg.to}`;
    });
  }
}
