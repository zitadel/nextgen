import type { ReleaseChannel } from "./channel";
import { Dependencies } from "./dependencies";
import { ReleaseLookupError } from "./errors";
import type { PackageInstaller } from "./installer";
import { UpgradePlan } from "./plan";

/**
 * What an {@link Upgrader} is given.
 */
export type UpgraderOptions = Readonly<{
  /**
   * The running tool's version.
   */
  cliVersion: string;

  /**
   * The project directory.
   */
  cwd: string;

  /**
   * The prefix of the packages that move together, such as `@acme/`.
   */
  scope: string;

  /**
   * Change nothing; say what would change.
   */
  dryRun: boolean;

  /**
   * Where the newest release is looked up.
   */
  channel: ReleaseChannel;

  /**
   * What installs the new packages.
   */
  installer: PackageInstaller;
}>;

/**
 * What {@link Upgrader.apply} did.
 */
export type UpgradeResult = Readonly<{
  /**
   * Whether the new packages were installed. A dry run installs nothing.
   */
  installed: boolean;

  /**
   * The install as the person's shell reads it, when one was needed.
   */
  installCommand: string | undefined;
}>;

/**
 * Moves one project's packages to the latest release. It decides first and acts
 * second, in two calls, so a caller can show what is about to happen before it
 * does.
 */
export class Upgrader {
  /**
   * What the upgrader was given.
   */
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
   * Decides what an upgrade would change, touching nothing. It asks the registry
   * afresh, past any cache, because a person who typed `upgrade` wants the
   * newest release and not yesterday's answer.
   *
   * @returns The plan.
   * @throws A {@link ReleaseLookupError} when the latest release cannot be looked up.
   */
  async plan(): Promise<UpgradePlan> {
    const { cliVersion, cwd, scope, channel } = this.options;
    const latest = await channel.latest({ fresh: true });
    if (latest === undefined) {
      throw new ReleaseLookupError();
    }
    return UpgradePlan.create({
      cliVersion,
      latest,
      dependencies: await Dependencies.read(cwd, scope),
    });
  }

  /**
   * Installs the plan's packages. A dry run installs nothing, and still says what
   * it would have run, so the person can see it.
   *
   * @param plan - What {@link Upgrader.plan} returned.
   * @returns What was done.
   * @throws An `InstallError` when the install fails.
   */
  async apply(plan: UpgradePlan): Promise<UpgradeResult> {
    const { dryRun, installer } = this.options;
    const install = await installer.plan(plan);
    if (install === undefined) {
      return {
        installed: false,
        installCommand: undefined,
      };
    }
    if (dryRun) {
      return {
        installed: false,
        installCommand: install.display,
      };
    }
    await installer.install(install);
    return {
      installed: true,
      installCommand: install.display,
    };
  }
}
