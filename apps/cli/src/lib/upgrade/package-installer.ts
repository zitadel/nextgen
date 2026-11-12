import {
  addExactCommandFor,
  detectPackageManager,
  inDirectory,
  type PackageCommand,
  runPackageCommand,
} from "@/lib/package-manager";

import { InstallError } from "./errors";
import type { UpgradePlan } from "./upgrade-plan";

/** The install a plan needs, and how it reads in the person's shell. */
export type PlannedInstall = Readonly<{ run: PackageCommand; display: string }>;

/** What a {@link PackageInstaller} is given. */
export type PackageInstallerOptions = Readonly<{
  cwd: string;
  typedCwd: string | undefined;
  redirectStdoutToStderr: boolean;
}>;

/** Installs a plan's packages with the project's own package manager. */
export class PackageInstaller {
  /** What the run was given. */
  private readonly options: PackageInstallerOptions;

  /**
   * @param options.cwd - The project directory.
   * @param options.typedCwd - `--cwd` as typed, so the displayed command runs from the shell's directory.
   * @param options.redirectStdoutToStderr - Whether a package manager's progress must stay off stdout.
   */
  constructor(options: PackageInstallerOptions) {
    this.options = options;
  }

  /**
   * The install the plan needs, in the project's own package manager and with an
   * exact-save flag, so a pin stays a pin.
   *
   * @returns The install, or `undefined` when no package moves.
   */
  async plan(plan: UpgradePlan): Promise<PlannedInstall | undefined> {
    if (plan.packages.length === 0) {
      return undefined;
    }
    const run = addExactCommandFor(await detectPackageManager(this.options.cwd), [...plan.specs]);
    return {
      run,
      display: inDirectory(run, this.options.typedCwd, this.options.cwd).display,
    };
  }

  /**
   * Runs the install.
   *
   * @param install - What {@link PackageInstaller.plan} returned.
   * @throws An {@link InstallError} when the package manager fails.
   */
  async install(install: PlannedInstall): Promise<void> {
    try {
      await runPackageCommand(install.run, {
        cwd: this.options.cwd,
        redirectStdoutToStderr: this.options.redirectStdoutToStderr,
      });
    } catch (error) {
      throw new InstallError(install.display, error);
    }
  }
}
