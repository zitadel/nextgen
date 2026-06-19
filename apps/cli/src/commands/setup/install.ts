import { consola } from "consola";

import { ZitadelError } from "../../lib/errors";
import {
  detectPackageManager,
  devCommandFor,
  installCommandFor,
  runPackageCommand,
  type PackageCommand,
  type PackageManager,
} from "../../lib/package-manager";

type InstallReason = "dry-run" | "skip-install" | "no-dependency-changes";

export type SetupInstall = {
  status: "completed" | "skipped" | "not-needed";
  package_manager: PackageManager;
  command: string;
  reason?: InstallReason;
};

export type SetupInstallOutcome = {
  install: SetupInstall;
  devCommand: string;
  nextActions: string[];
  nextCommands: string[];
};

export type SetupInstallInput = {
  cwd: string;
  depsAdded: ReadonlyArray<string>;
  dryRun: boolean;
  env: NodeJS.ProcessEnv;
  issuer: string;
  json: boolean;
  scaffoldedFramework: boolean;
  skipInstall: boolean;
  run?: typeof runPackageCommand;
};

export async function installDependenciesForSetup(
  input: SetupInstallInput,
): Promise<SetupInstallOutcome> {
  const packageManager = await detectPackageManager(input.cwd);
  const installCommand = installCommandFor(packageManager);
  const devCommand = devCommandFor(packageManager);
  const needsInstall = input.scaffoldedFramework || input.depsAdded.length > 0;

  if (!needsInstall) {
    return outcome({
      install: {
        status: "not-needed",
        package_manager: packageManager,
        command: installCommand.display,
        reason: "no-dependency-changes",
      },
      devCommand: devCommand.display,
      issuer: input.issuer,
      includeInstallCommand: false,
    });
  }

  if (input.dryRun || input.skipInstall) {
    return outcome({
      install: {
        status: "skipped",
        package_manager: packageManager,
        command: installCommand.display,
        reason: input.dryRun ? "dry-run" : "skip-install",
      },
      devCommand: devCommand.display,
      issuer: input.issuer,
      includeInstallCommand: true,
    });
  }

  consola.start(`Installing dependencies with ${installCommand.display}`);
  try {
    await (input.run ?? runPackageCommand)(installCommand, {
      cwd: input.cwd,
      env: input.env,
      redirectStdoutToStderr: input.json,
    });
  } catch (error) {
    throw installFailed(error, installCommand, devCommand, input.cwd);
  }
  consola.success("Installed dependencies");

  return outcome({
    install: {
      status: "completed",
      package_manager: packageManager,
      command: installCommand.display,
    },
    devCommand: devCommand.display,
    issuer: input.issuer,
    includeInstallCommand: false,
  });
}

function outcome(input: {
  install: SetupInstall;
  devCommand: string;
  issuer: string;
  includeInstallCommand: boolean;
}): SetupInstallOutcome {
  const startAction = `Start your project: ${input.devCommand} (then open ${input.issuer})`;
  const verifyAction =
    "Verify auth in the browser: register a user, log out, log in again with the same user, and confirm /profile shows Signed in.";
  return {
    install: input.install,
    devCommand: input.devCommand,
    nextActions: input.includeInstallCommand
      ? [`Install dependencies: ${input.install.command}`, startAction, verifyAction]
      : [startAction, verifyAction],
    nextCommands: input.includeInstallCommand
      ? [input.install.command, input.devCommand]
      : [input.devCommand],
  };
}

function installFailed(
  error: unknown,
  installCommand: PackageCommand,
  devCommand: PackageCommand,
  cwd: string,
): ZitadelError {
  return new ZitadelError("E_VALIDATION", `Dependency install failed: ${installCommand.display}`, {
    hint: `Run ${installCommand.display} in ${cwd}, then start the app with ${devCommand.display}.`,
    nextCommands: [installCommand.display],
    details: { command: installCommand.display, cwd, original: errorShape(error) },
  });
}

function errorShape(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      code: (error as NodeJS.ErrnoException).code,
    };
  }
  return { message: String(error) };
}
