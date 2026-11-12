import { execa } from "execa";

import { errorMessage, ZitadelError } from "@/lib/errors";
import {
  addExactCommandFor,
  detectPackageManager,
  inDirectory,
  type PackageCommand,
  runPackageCommand,
} from "@/lib/package-manager";
import type { SuggestedCommand } from "@/lib/suggestion";

import type { UpgradePlan } from "./upgrade-plan";
import type { UpgradeTarget } from "./upgrade-target";

const REFRESH_TIMEOUT_MS = 5 * 60 * 1000;

/** How rerunning `doctor --fix` at the new version ended, when it ran at all. */
export type Refresh = "done" | "issues" | "failed" | "planned" | "skipped";

/** The install a plan needs, and how it reads in the person's shell. */
export type PlannedInstall = { run: PackageCommand; display: string };

/** Applies a plan to one project with the project's own package manager. */
export class ProjectInstaller {
  /** What is being upgraded. */
  private readonly target: UpgradeTarget;
  /** What the run was given. */
  private readonly options: Readonly<{
    cwd: string;
    typedCwd: string | undefined;
    env: NodeJS.ProcessEnv;
    json: boolean;
    noTelemetry: boolean;
    signal: AbortSignal;
  }>;

  /**
   * @param target - What is being upgraded.
   * @param options.cwd - The project directory.
   * @param options.typedCwd - `--cwd` as typed, so the displayed command runs from the shell's directory.
   * @param options.env - The run's environment.
   * @param options.json - Whether stdout is the one envelope, which a package manager's progress would break.
   * @param options.noTelemetry - `--no-telemetry` was given: it reaches this run only, not the child, without being passed on.
   * @param options.signal - Ctrl-C: it ends the child and the upgrade with it, rather than a refresh that merely failed.
   */
  constructor(
    target: UpgradeTarget,
    options: Readonly<{
      cwd: string;
      typedCwd: string | undefined;
      env: NodeJS.ProcessEnv;
      json: boolean;
      noTelemetry: boolean;
      signal: AbortSignal;
    }>,
  ) {
    this.target = target;
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
   * @param install - What {@link ProjectInstaller.plan} returned.
   * @param retry - What to suggest when it fails, so the person can rerun.
   * @throws A `ZitadelError` `E_VALIDATION` when the package manager fails.
   */
  async install(install: PlannedInstall, retry: readonly SuggestedCommand[]): Promise<void> {
    try {
      await runPackageCommand(install.run, {
        cwd: this.options.cwd,
        redirectStdoutToStderr: this.options.json,
      });
    } catch (error) {
      throw new ZitadelError("E_VALIDATION", "Could not install the new packages", {
        hint: `${errorMessage(error)}. Nothing else changed; fix that and rerun.`,
        nextCommands: [...retry],
      });
    }
  }

  /**
   * Runs the new release's `doctor --fix`, because only that release knows what it
   * generates. As a child, its one envelope captured: it must not print into this
   * command's output. It repairs and then verifies, so a run that reports issues
   * still repaired what it could, and those are for the person to look at; the new
   * packages stay either way.
   *
   * @param version - The release to run.
   * @throws The signal's reason when the run was interrupted.
   */
  async refresh(version: string): Promise<Refresh> {
    const { cwd, env, noTelemetry, signal } = this.options;
    try {
      const result = await execa(
        "npx",
        [
          "--yes",
          `${this.target.cliPackage}@${version}`,
          "doctor",
          "--fix",
          "--non-interactive",
          "--json",
          ...(noTelemetry ? ["--no-telemetry"] : []),
        ],
        {
          cwd,
          env: {
            ...env,
            [this.target.updateCheckVariable]: "0",
          },
          extendEnv: false,
          reject: false,
          stdin: "ignore",
          timeout: REFRESH_TIMEOUT_MS,
          cancelSignal: signal,
        },
      );
      signal.throwIfAborted();
      const envelope = JSON.parse(result.stdout) as { status?: unknown };
      return envelope.status === "ok" ? "done" : "issues";
    } catch {
      signal.throwIfAborted();
      return "failed";
    }
  }
}
