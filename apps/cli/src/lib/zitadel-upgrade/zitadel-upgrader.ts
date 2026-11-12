import { errorMessage, ZitadelError } from "@/lib/errors";
import { breakingChanges } from "@/lib/release-notes";
import { shellCommand, type SuggestedCommand } from "@/lib/suggestion";
import {
  InstallError,
  PackageInstaller,
  ReleaseLookupError,
  type UpgradePlan,
  Upgrader,
} from "@/lib/upgrade";

import { UpgradeReport } from "./upgrade-report";
import { ZITADEL } from "./zitadel";
import { ZitadelRefresher } from "./zitadel-refresher";
import { ZitadelReleaseChannel } from "./zitadel-release-channel";

/** What a {@link ZitadelUpgrader} is given. */
export type ZitadelUpgraderOptions = Readonly<{
  cliVersion: string;
  cwd: string;
  typedCwd: string | undefined;
  env: NodeJS.ProcessEnv;
  json: boolean;
  noTelemetry: boolean;
  dryRun: boolean;
  signal: AbortSignal;
  retry: SuggestedCommand;
}>;

/** What {@link ZitadelUpgrader.apply} did. */
export type ZitadelUpgradeResult = Readonly<{
  /** Whether the new packages were installed; a dry run installs nothing. */
  installed: boolean;
  /** The lines a person reads and the data a script parses. */
  report: UpgradeReport;
}>;

/** Upgrades a project to the latest Zitadel release, refusing the way the CLI refuses. */
export class ZitadelUpgrader {
  /** What does the upgrading. */
  private readonly upgrader: Upgrader;

  /** What the run was given. */
  private readonly options: ZitadelUpgraderOptions;

  /**
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
  constructor(options: ZitadelUpgraderOptions) {
    this.options = options;
    this.upgrader = new Upgrader(ZITADEL, {
      cliVersion: options.cliVersion,
      cwd: options.cwd,
      dryRun: options.dryRun,
      channel: new ZitadelReleaseChannel(options.cliVersion, options.env),
      changes: { breakingChanges },
      installer: new PackageInstaller({
        cwd: options.cwd,
        typedCwd: options.typedCwd,
        redirectStdoutToStderr: options.json,
      }),
      refresher: new ZitadelRefresher({
        cwd: options.cwd,
        env: options.env,
        noTelemetry: options.noTelemetry,
        signal: options.signal,
      }),
    });
  }

  /**
   * Decides what an upgrade would change, touching nothing.
   *
   * @throws A `ZitadelError` `E_NETWORK` when the latest release cannot be looked up.
   */
  async plan(): Promise<UpgradePlan> {
    try {
      return await this.upgrader.plan();
    } catch (error) {
      if (!(error instanceof ReleaseLookupError)) {
        throw error;
      }
      throw new ZitadelError("E_NETWORK", "Could not look up the latest Zitadel release", {
        hint: "Check the connection to the npm registry, then rerun.",
        nextCommands: [this.options.retry],
      });
    }
  }

  /**
   * Carries a plan out.
   *
   * @param plan - What {@link ZitadelUpgrader.plan} returned.
   * @throws A `ZitadelError` `E_VALIDATION` when the install fails.
   */
  async apply(plan: UpgradePlan): Promise<ZitadelUpgradeResult> {
    try {
      const { refresh, installed, installCommand } = await this.upgrader.apply(plan);
      return {
        installed,
        report: new UpgradeReport(plan, {
          refresh,
          dryRun: this.options.dryRun,
          installCommand,
        }),
      };
    } catch (error) {
      if (!(error instanceof InstallError)) {
        throw error;
      }
      throw new ZitadelError("E_VALIDATION", "Could not install the new packages", {
        hint: `${errorMessage(error.cause)}. Nothing else changed; fix that and rerun.`,
        nextCommands: [shellCommand(error.command), this.options.retry],
      });
    }
  }
}
