import type { ZitadelError } from "@/lib/errors";
import { log } from "@/lib/log";
import {
  detectPackageManager,
  installCommandFor,
  type PackageCommand,
  type PackageManager,
  runPackageCommand,
} from "@/lib/package-manager";

/** Why an install did not run. */
type InstallReason = "dry-run" | "skip-install" | "no-dependency-changes";

/** What a command's dependency install did, as its envelope reports it. */
export type DependencyInstall = {
  status: "completed" | "would-run" | "skipped" | "not-needed";
  package_manager: PackageManager;
  command: string;
  reason?: InstallReason;
};

/**
 * Installs what a command added to `package.json`, with the package manager
 * the project already uses. Nothing to install is `not-needed`; a dry run or
 * `--skip-install` names the command without running it.
 *
 * @param input - Where to install, whether anything changed, how the run
 *   goes, how the step is drawn (the command's `this.ui.task`), and the error
 *   a failed install becomes.
 * @returns What the install did, and the command it ran or would run.
 * @throws What `failed` returns, when the package manager fails.
 */
export async function installDependencies(input: {
  cwd: string;
  needed: boolean;
  dryRun: boolean;
  skipInstall: boolean;
  env: NodeJS.ProcessEnv;
  json: boolean;
  task: <T>(label: string, work: () => Promise<T>, done?: (result: T) => string) => Promise<T>;
  failed: (error: unknown, command: PackageCommand) => ZitadelError;
  run?: typeof runPackageCommand;
}): Promise<{ install: DependencyInstall; command: PackageCommand }> {
  const packageManager = await detectPackageManager(input.cwd);
  const command = installCommandFor(packageManager);
  const report = (status: DependencyInstall["status"], reason?: InstallReason) => {
    return {
      install: {
        status,
        package_manager: packageManager,
        command: command.display,
        ...(reason === undefined ? {} : { reason }),
      },
      command,
    };
  };

  if (!input.needed) {
    return report("not-needed", "no-dependency-changes");
  }
  if (input.dryRun) {
    return report("would-run");
  }
  if (input.skipInstall) {
    return report("skipped", "skip-install");
  }

  const label = `Installing dependencies with ${command.display}`;
  const install = async (): Promise<void> => {
    try {
      await (input.run ?? runPackageCommand)(command, {
        cwd: input.cwd,
        env: input.env,
        redirectStdoutToStderr: input.json,
      });
    } catch (error) {
      throw input.failed(error, command);
    }
  };

  if (input.json) {
    await input.task(label, install, () => {
      return "Installed dependencies";
    });
  } else {
    // The package manager writes to the terminal itself, so no spinner may draw over it.
    log.start(label);
    await install();
    log.done("Installed dependencies");
  }
  return report("completed");
}
