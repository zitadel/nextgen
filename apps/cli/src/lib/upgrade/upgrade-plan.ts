import semver from "semver";

import { type BreakingChange, breakingChanges } from "@/lib/release-notes";

import type { Dependency } from "./dependency";
import type { Release } from "./release";
import type { ScopedDependencies } from "./scoped-dependencies";

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
  /** The breaking changes between the oldest version involved and the target. */
  readonly breaking: readonly BreakingChange[];

  private constructor(
    cliVersion: string,
    target: string,
    packages: readonly PackageUpgrade[],
    leftAlone: readonly Dependency[],
    breaking: readonly BreakingChange[],
  ) {
    this.cliVersion = cliVersion;
    this.target = target;
    this.packages = packages;
    this.leftAlone = leftAlone;
    this.breaking = breaking;
  }

  /**
   * @param input.cliVersion - The running CLI's version.
   * @param input.latest - What the registry answered. A CLI ahead of it (a
   * prerelease) is what its own files target, so it is never moved back.
   * @param input.dependencies - The project's dependencies.
   */
  static async create(input: {
    cliVersion: string;
    latest: Release;
    dependencies: ScopedDependencies | undefined;
  }): Promise<UpgradePlan> {
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
    const upToDate = target === cliVersion && packages.length === 0;
    const oldest = [
      cliVersion,
      ...packages.map((pkg) => {
        return pkg.from;
      }),
    ].sort(semver.compare)[0];
    return new UpgradePlan(
      cliVersion,
      target,
      packages,
      dependencies?.floating() ?? [],
      upToDate ? [] : await breakingChanges(oldest ?? "0.0.0", target),
    );
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
