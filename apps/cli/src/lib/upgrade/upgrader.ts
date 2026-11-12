import { ZitadelError } from "@/lib/errors";
import { hasZitadelConfig } from "@/lib/project";
import { shellCommand, type SuggestedCommand } from "@/lib/suggestion";

import { ProjectInstaller, type Refresh } from "./project-installer";
import { ReleaseChannel } from "./release-channel";
import { ScopedDependencies } from "./scoped-dependencies";
import { UpgradePlan } from "./upgrade-plan";
import { UpgradeReport } from "./upgrade-report";
import type { UpgradeTarget } from "./upgrade-target";

/** What {@link Upgrader.apply} did. */
export type UpgradeResult = Readonly<{
  /** What was decided. */
  plan: UpgradePlan;
  /** How the refresh ended. */
  refresh: Refresh;
  /** Whether the new packages were installed; a dry run installs nothing. */
  installed: boolean;
  /** The lines a person reads and the data a script parses. */
  report: UpgradeReport;
}>;

/** Moves one project to the latest release: the one thing a caller needs to upgrade. */
export class Upgrader {
  /** What is being upgraded. */
  private readonly target: UpgradeTarget;

  /** What the run was given. */
  private readonly options: Readonly<{
    cliVersion: string;
    cwd: string;
    dryRun: boolean;
    retry: SuggestedCommand;
  }>;

  /** Where the newest release is looked up. */
  private readonly channel: ReleaseChannel;

  /** What changes the project. */
  private readonly installer: ProjectInstaller;

  /**
   * @param target - What is being upgraded.
   * @param options.cliVersion - The running CLI's version.
   * @param options.cwd - The project directory.
   * @param options.typedCwd - `--cwd` as typed, so a displayed command runs from the shell's directory.
   * @param options.env - The run's environment.
   * @param options.json - Whether stdout is the one envelope, which a package manager's progress would break.
   * @param options.noTelemetry - `--no-telemetry` was given.
   * @param options.dryRun - Change nothing; say what would change.
   * @param options.signal - Ctrl-C, which ends the upgrade rather than failing a step.
   * @param options.retry - The command that reruns this upgrade, suggested when a step fails.
   */
  constructor(
    target: UpgradeTarget,
    options: Readonly<{
      cliVersion: string;
      cwd: string;
      typedCwd: string | undefined;
      env: NodeJS.ProcessEnv;
      json: boolean;
      noTelemetry: boolean;
      dryRun: boolean;
      signal: AbortSignal;
      retry: SuggestedCommand;
    }>,
  ) {
    this.target = target;
    this.options = options;
    this.channel = new ReleaseChannel(target, options.cliVersion, options.env);
    this.installer = new ProjectInstaller(target, options);
  }

  /**
   * Decides what an upgrade would change, touching nothing.
   *
   * @returns The plan.
   * @throws A `ZitadelError` `E_NETWORK` when the latest release cannot be looked up.
   */
  async plan(): Promise<UpgradePlan> {
    const latest = await this.channel.latestFresh();
    if (latest === undefined) {
      throw new ZitadelError("E_NETWORK", "Could not look up the latest Zitadel release", {
        hint: "Check the connection to the npm registry, then rerun.",
        nextCommands: [this.options.retry],
      });
    }
    return UpgradePlan.create({
      cliVersion: this.options.cliVersion,
      latest,
      dependencies: await ScopedDependencies.read(this.options.cwd, this.target.scope),
    });
  }

  /**
   * Carries a plan out: installs the new packages, then has the new release
   * regenerate the project's files. A dry run does neither.
   *
   * @param plan - What {@link Upgrader.plan} returned.
   * @throws A `ZitadelError` `E_VALIDATION` when the install fails.
   */
  async apply(plan: UpgradePlan): Promise<UpgradeResult> {
    const { dryRun, cwd, retry } = this.options;
    const install = await this.installer.plan(plan);
    const installCommand = install === undefined ? undefined : shellCommand(install.display);
    const installs = install !== undefined && installCommand !== undefined && !dryRun;
    if (installs) {
      await this.installer.install(install, [installCommand, retry]);
    }
    const refreshes = install !== undefined && (await hasZitadelConfig(cwd));
    const refresh = await this.refresh(plan, refreshes);
    return {
      plan,
      refresh,
      installed: installs,
      report: new UpgradeReport(plan, { refresh, dryRun, installCommand }),
    };
  }

  /**
   * @param plan - What is being applied.
   * @param refreshes - Whether the project is one the new release regenerates files for.
   * @returns `skipped` when it is not, `planned` on a dry run, else how the refresh ended.
   */
  private async refresh(plan: UpgradePlan, refreshes: boolean): Promise<Refresh> {
    if (!refreshes) {
      return "skipped";
    }
    return this.options.dryRun ? "planned" : this.installer.refresh(plan.target);
  }
}
