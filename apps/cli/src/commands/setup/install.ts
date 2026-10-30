import type { BoxAction } from "../../lib/box";
import { ZitadelError } from "../../lib/errors";
import { customizeAndPublishActions, verifyLoginAction } from "../../lib/journey-guidance";
import {
  detectPackageManager,
  devCommandFor,
  inDirectory,
  installCommandFor,
  runPackageCommand,
  type PackageCommand,
  type PackageManager,
} from "../../lib/package-manager";
import {
  type EnvironmentSelector,
  projectCommand,
  shellCommand,
  type SuggestedCommand,
} from "../../lib/suggestion";

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
   * out until login demonstrably works (Elina, alpha.15). Structured so the
   * box renderer can pull each command onto its own styled line; the envelope
   * strings below stay plain prose.
   */
  boxActions: BoxAction[];
  /** Complete journey for the JSON envelope — agents consume all of it. */
  nextActions: string[];
  nextCommands: SuggestedCommand[];
};

export type SetupInstallInput = {
  cliVersion: string;
  cwd: string;
  /**
   * `--cwd` as typed. The suggested install and dev commands then name the
   * directory, as every other follow-up carries `--cwd`; run from the shell's
   * own directory they would act on whatever project is there.
   */
  cwdFlag?: string;
  depsAdded: ReadonlyArray<string>;
  dryRun: boolean;
  env: NodeJS.ProcessEnv;
  issuer: string;
  json: boolean;
  /**
   * The selector pinning the project setup just created, for the follow-ups
   * below. Without it a bare `status`/`deploy` resolves the environment as the
   * next shell does, where the process environment outranks the `.env` files:
   * in a shell holding production values the follow-up would read — or publish
   * to — another project.
   */
  selector: EnvironmentSelector;
  scaffoldedFramework: boolean;
  skipInstall: boolean;
  /**
   * How the install is drawn: the command's `this.ui.task`, so the step sits
   * in the same chain as every other one setup reports. Passed in rather than
   * reached for, because this module draws nothing itself.
   */
  task: <T>(label: string, work: () => Promise<T>, done?: (result: T) => string) => Promise<T>;
  run?: typeof runPackageCommand;
};

export async function installDependenciesForSetup(
  input: SetupInstallInput,
): Promise<SetupInstallOutcome> {
  const packageManager = await detectPackageManager(input.cwd);
  const installCommand = installCommandFor(packageManager);
  const devCommand = devCommandFor(packageManager);
  // What the reader runs, from the shell's directory; setup itself runs the
  // plain commands in `cwd`.
  const shownInstall = inDirectory(installCommand, input.cwdFlag, input.cwd).display;
  const shownDev = inDirectory(devCommand, input.cwdFlag, input.cwd).display;
  const needsInstall = input.scaffoldedFramework || input.depsAdded.length > 0;

  if (!needsInstall) {
    return outcome({
      install: {
        status: "not-needed",
        package_manager: packageManager,
        command: installCommand.display,
        reason: "no-dependency-changes",
      },
      devCommand: shownDev,
      installCommand: shownInstall,
      cliVersion: input.cliVersion,
      issuer: input.issuer,
      selector: input.selector,
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
      devCommand: shownDev,
      installCommand: shownInstall,
      cliVersion: input.cliVersion,
      issuer: input.issuer,
      selector: input.selector,
      includeInstallCommand: true,
    });
  }

  await input.task(
    `Installing dependencies with ${installCommand.display}`,
    async () => {
      try {
        await (input.run ?? runPackageCommand)(installCommand, {
          cwd: input.cwd,
          env: input.env,
          redirectStdoutToStderr: input.json,
        });
      } catch (error) {
        throw installFailed(error, installCommand, devCommand, shownInstall, input.cwd);
      }
    },
    () => "Installed dependencies",
  );

  return outcome({
    install: {
      status: "completed",
      package_manager: packageManager,
      command: installCommand.display,
    },
    devCommand: shownDev,
    installCommand: shownInstall,
    cliVersion: input.cliVersion,
    issuer: input.issuer,
    selector: input.selector,
    includeInstallCommand: false,
  });
}

function outcome(input: {
  install: SetupInstall;
  devCommand: string;
  /** {@link SetupInstall.command} as the reader runs it. */
  installCommand: string;
  cliVersion: string;
  issuer: string;
  selector: EnvironmentSelector;
  includeInstallCommand: boolean;
}): SetupInstallOutcome {
  const planCommand = projectCommand("deploy --dry-run", input.selector, input.cliVersion);
  const statusCommand = projectCommand("status", input.selector, input.cliVersion);
  const verifyActions = [
    ...(input.includeInstallCommand ? [`Install dependencies: ${input.installCommand}`] : []),
    `Start your project: ${input.devCommand} (then open ${input.issuer}/login)`,
    verifyLoginAction(),
  ];
  // Every step is a sentence that says what its command cannot say for
  // itself — why it is here, or when to run it. `Run next:` is the label for
  // commands nothing introduces, and a box that introduces its own commands
  // never needs it.
  const boxActions: BoxAction[] = [
    ...(input.includeInstallCommand
      ? [
          {
            text: "Setup did not install the new dependencies, so install them first:",
            command: input.installCommand,
          },
        ]
      : []),
    { text: `Start your project (then open ${input.issuer}/login):`, command: input.devCommand },
    { text: verifyLoginAction() },
    // The dev server holds the terminal it starts in, and every later command
    // reads `.zitadel/` from this directory.
    {
      text: "The dev server keeps its terminal busy. Open a second terminal in this directory for further commands.",
    },
    { text: "Once login works, this shows your next steps:", command: statusCommand },
    { text: "Customizing the login is covered in your README's Zitadel section." },
  ];
  return {
    install: input.install,
    devCommand: input.devCommand,
    boxActions,
    nextActions: [
      ...verifyActions,
      ...customizeAndPublishActions(input.cliVersion, input.selector),
    ],
    nextCommands: input.includeInstallCommand
      ? [shellCommand(input.installCommand), shellCommand(input.devCommand), planCommand]
      : [shellCommand(input.devCommand), planCommand],
  };
}

function installFailed(
  error: unknown,
  installCommand: PackageCommand,
  devCommand: PackageCommand,
  shownInstall: string,
  cwd: string,
): ZitadelError {
  return new ZitadelError("E_VALIDATION", `Dependency install failed: ${installCommand.display}`, {
    hint: `Run ${installCommand.display} in ${cwd}, then start the app with ${devCommand.display}.`,
    nextCommands: [shellCommand(shownInstall)],
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
