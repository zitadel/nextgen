import { consola } from "consola";

import { ZitadelError } from "../../lib/errors";
import { customizeAndPublishActions, verifyLoginAction } from "../../lib/journey-guidance";
import {
  detectPackageManager,
  devCommandFor,
  installCommandFor,
  runPackageCommand,
  type PackageCommand,
  type PackageManager,
} from "../../lib/package-manager";
import { publicCliCommand } from "../../lib/public-cli";

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
  /**
   * Journey-staged subset for the human terminal box: the verify mission
   * plus one breadcrumb to `status`/README. Customize/publish guidance stays
   * out until login demonstrably works (Elina, alpha.15).
   */
  boxActions: string[];
  /** Complete journey for the JSON envelope — agents consume all of it. */
  nextActions: string[];
  nextCommands: string[];
};

export type SetupInstallInput = {
  cliVersion: string;
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
      cliVersion: input.cliVersion,
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
      cliVersion: input.cliVersion,
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
    cliVersion: input.cliVersion,
    issuer: input.issuer,
    includeInstallCommand: false,
  });
}

function outcome(input: {
  install: SetupInstall;
  devCommand: string;
  cliVersion: string;
  issuer: string;
  includeInstallCommand: boolean;
}): SetupInstallOutcome {
  const planCommand = publicCliCommand("plan", input.cliVersion);
  const statusCommand = publicCliCommand("status", input.cliVersion);
  const verifyActions = [
    ...(input.includeInstallCommand ? [`Install dependencies: ${input.install.command}`] : []),
    `Start your project: ${input.devCommand} (then open ${input.issuer}/login)`,
    verifyLoginAction(),
  ];
  const breadcrumb = `Once login works: ${statusCommand} shows your next steps; customizing is covered in your README's Zitadel section.`;
  return {
    install: input.install,
    devCommand: input.devCommand,
    boxActions: [...verifyActions, breadcrumb],
    nextActions: [...verifyActions, ...customizeAndPublishActions(input.cliVersion)],
    nextCommands: input.includeInstallCommand
      ? [input.install.command, input.devCommand, planCommand]
      : [input.devCommand, planCommand],
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
