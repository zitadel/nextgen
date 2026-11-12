import {
  addExactCommandFor,
  detectPackageManager,
  inDirectory,
  type PackageCommand,
  runPackageCommand,
} from "@/lib/package-manager";

import { InstallError } from "./errors";
import type { UpgradePlan } from "./plan";

/** The install a plan needs, and how it reads in the person's shell. */
export type PlannedInstall = Readonly<{ run: PackageCommand; display: string }>;

/** What a {@link PackageInstaller} is given. */
export type InstallerOptions = Readonly<{
  cwd: string;
  /** `--cwd` as typed, so the displayed command runs from the shell's directory. */
  typedCwd: string | undefined;
  /** Whether a package manager's progress must stay off stdout. */
  redirectStdoutToStderr: boolean;
}>;

/** Installs a plan's packages with the project's own package manager. */
export class PackageInstaller {
  /** What the installer was given. */
  private readonly options: InstallerOptions;

  /**
   * @param options.cwd - The project directory.
   * @param options.typedCwd - `--cwd` as typed.
   * @param options.redirectStdoutToStderr - Whether progress must stay off stdout.
   */
  constructor(options: InstallerOptions) {
    this.options = options;
  }

  /**
   * The install the plan needs, with an exact-save flag so a pin stays a pin.
   *
   * @returns The install, or `undefined` when no package moves.
   */
  async plan(plan: UpgradePlan): Promise<PlannedInstall | undefined> {
    if (plan.packages.length === 0) {
      return undefined;
    }
    const { cwd, typedCwd } = this.options;
    const run = addExactCommandFor(await detectPackageManager(cwd), [...plan.specs]);
    return { run, display: inDirectory(run, typedCwd, cwd).display };
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
