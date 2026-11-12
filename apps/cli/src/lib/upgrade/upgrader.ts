import type { ReleaseChannel } from "./channel";
import { Dependencies } from "./dependencies";
import { ReleaseLookupError } from "./errors";
import type { PackageInstaller } from "./installer";
import { UpgradePlan } from "./plan";

/** What an {@link Upgrader} is given. */
export type UpgraderOptions = Readonly<{
  cliVersion: string;
  cwd: string;
  /** The prefix of the packages that move together, such as `@acme/`. */
  scope: string;
  /** Change nothing; say what would change. */
  dryRun: boolean;
  channel: ReleaseChannel;
  installer: PackageInstaller;
}>;

/** What {@link Upgrader.apply} did. */
export type UpgradeResult = Readonly<{
  /** Whether the new packages were installed; a dry run installs nothing. */
  installed: boolean;
  /** The install as the person's shell reads it, when one was needed. */
  installCommand: string | undefined;
}>;

/** Moves one project's packages to the latest release. */
export class Upgrader {
  /** What the upgrader was given. */
  private readonly options: UpgraderOptions;

  /**
   * @param options.cliVersion - The running tool's version.
   * @param options.cwd - The project directory.
   * @param options.scope - The prefix of the packages that move together.
   * @param options.dryRun - Change nothing; say what would change.
   * @param options.channel - Where the newest release is looked up.
   * @param options.installer - What installs the new packages.
   */
  constructor(options: UpgraderOptions) {
    this.options = options;
  }

  /**
   * Decides what an upgrade would change, touching nothing.
   *
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
      dependencies: await Dependencies.read(this.options.cwd, this.options.scope),
    });
  }

  /**
   * Installs the plan's packages. A dry run installs nothing.
   *
   * @param plan - What {@link Upgrader.plan} returned.
   * @throws An `InstallError` when the install fails.
   */
  async apply(plan: UpgradePlan): Promise<UpgradeResult> {
    const install = await this.options.installer.plan(plan);
    const installs = install !== undefined && !this.options.dryRun;
    if (installs) {
      await this.options.installer.install(install);
    }
    return { installed: installs, installCommand: install?.display };
  }
}
