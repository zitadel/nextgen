import type { ChangeSource } from "./change-source";
import { ReleaseLookupError } from "./errors";
import type { PackageInstaller } from "./package-installer";
import type { ReleaseChannel } from "./release-channel";
import type { Refresh, Refresher } from "./refresher";
import { ScopedDependencies } from "./scoped-dependencies";
import { UpgradePlan } from "./upgrade-plan";
import type { UpgradeTarget } from "./upgrade-target";

/** What {@link Upgrader.apply} did. */
export type UpgradeResult = Readonly<{
  /** What was decided. */
  plan: UpgradePlan;
  /** How the refresh ended. */
  refresh: Refresh;
  /** Whether the new packages were installed; a dry run installs nothing. */
  installed: boolean;
  /** The install as the person's shell reads it, when one was needed. */
  installCommand: string | undefined;
}>;

/** Moves one project to the latest release. */
export class Upgrader {
  /** What is being upgraded. */
  private readonly target: UpgradeTarget;

  /** What the run was given. */
  private readonly options: Readonly<{
    cliVersion: string;
    cwd: string;
    dryRun: boolean;
    channel: ReleaseChannel;
    changes: ChangeSource;
    installer: PackageInstaller;
    refresher: Refresher;
  }>;

  /**
   * @param target - What is being upgraded.
   * @param options.cliVersion - The running tool's version.
   * @param options.cwd - The project directory.
   * @param options.dryRun - Change nothing; say what would change.
   * @param options.channel - Where the newest release is looked up.
   * @param options.changes - Where the breaking changes are read from.
   * @param options.installer - What installs the new packages.
   * @param options.refresher - What regenerates the project's files.
   */
  constructor(
    target: UpgradeTarget,
    options: Readonly<{
      cliVersion: string;
      cwd: string;
      dryRun: boolean;
      channel: ReleaseChannel;
      changes: ChangeSource;
      installer: PackageInstaller;
      refresher: Refresher;
    }>,
  ) {
    this.target = target;
    this.options = options;
  }

  /**
   * Decides what an upgrade would change, touching nothing.
   *
   * @returns The plan.
   * @throws A {@link ReleaseLookupError} when the latest release cannot be looked up.
   */
  async plan(): Promise<UpgradePlan> {
    const latest = await this.options.channel.latestFresh();
    if (latest === undefined) {
      throw new ReleaseLookupError();
    }
    return UpgradePlan.create({
      cliVersion: this.options.cliVersion,
      latest,
      dependencies: await ScopedDependencies.read(this.options.cwd, this.target.scope),
      changes: this.options.changes,
    });
  }

  /**
   * Carries a plan out: installs the new packages, then has the new release
   * regenerate the project's files. A dry run does neither.
   *
   * @param plan - What {@link Upgrader.plan} returned.
   * @throws An `InstallError` when the install fails.
   */
  async apply(plan: UpgradePlan): Promise<UpgradeResult> {
    const { dryRun, installer, refresher } = this.options;
    const install = await installer.plan(plan);
    const installs = install !== undefined && !dryRun;
    if (installs) {
      await installer.install(install);
    }
    const refreshes = install !== undefined && (await refresher.appliesTo());
    return {
      plan,
      refresh: await this.refresh(plan, refreshes),
      installed: installs,
      installCommand: install?.display,
    };
  }

  /**
   * @param plan - What is being applied.
   * @param refreshes - Whether a refresh applies to the project.
   * @returns `skipped` when it does not, `planned` on a dry run, else how the refresh ended.
   */
  private async refresh(plan: UpgradePlan, refreshes: boolean): Promise<Refresh> {
    if (!refreshes) {
      return "skipped";
    }
    return this.options.dryRun ? "planned" : this.options.refresher.refresh(plan.target);
  }
}
