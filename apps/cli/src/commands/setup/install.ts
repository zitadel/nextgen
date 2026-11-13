import type { BoxAction } from "@/lib/box";
import { ZitadelError } from "@/lib/errors";
import { type DependencyInstall, installDependencies } from "@/lib/install";
import { customizeAndPublishActions, verifyLoginAction } from "@/lib/journey-guidance";
import {
  detectPackageManager,
  devCommandFor,
  inDirectory,
  installCommandFor,
  type PackageCommand,
  type runPackageCommand,
} from "@/lib/package-manager";
import { type Suggest, type SuggestedCommand, shellCommand } from "@/lib/suggestion";

export type SetupInstall = DependencyInstall;

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
   * Renders the follow-ups below for the run. The run pins them to the project
   * setup just created: without that a bare `status`/`deploy` resolves the
   * environment as the next shell does, where the process environment outranks
   * the `.env` files, and in a shell holding production values the follow-up
   * would read — or publish to — another project.
   */
  suggest: Suggest;
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

/**
 * Installs what setup added, with the package manager the project already
 * uses, and reports what a reader runs next. A run that scaffolded nothing and
 * added no dependency installs nothing, and `--skip-install` leaves the
 * install to the reader while still naming the command.
 */
export async function installDependenciesForSetup(
  input: SetupInstallInput,
): Promise<SetupInstallOutcome> {
  const packageManager = await detectPackageManager(input.cwd);
  const devCommand = devCommandFor(packageManager);
  // What the reader runs, from the shell's directory; setup itself runs the
  // plain commands in `cwd`.
  const shownInstall = inDirectory(
    installCommandFor(packageManager),
    input.cwdFlag,
    input.cwd,
  ).display;
  const shownDev = inDirectory(devCommand, input.cwdFlag, input.cwd).display;
  const { install } = await installDependencies({
    cwd: input.cwd,
    needed: input.scaffoldedFramework || input.depsAdded.length > 0,
    dryRun: input.dryRun,
    skipInstall: input.skipInstall,
    env: input.env,
    json: input.json,
    task: input.task,
    failed: (error, installCommand) => {
      return installFailed(error, installCommand, devCommand, shownInstall, input.cwd);
    },
    ...(input.run === undefined ? {} : { run: input.run }),
  });

  return outcome({
    install,
    devCommand: shownDev,
    installCommand: shownInstall,
    issuer: input.issuer,
    suggest: input.suggest,
    includeInstallCommand: install.status === "would-run" || install.status === "skipped",
  });
}

function outcome(input: {
  install: SetupInstall;
  devCommand: string;
  /** {@link SetupInstall.command} as the reader runs it. */
  installCommand: string;
  issuer: string;
  suggest: Suggest;
  includeInstallCommand: boolean;
}): SetupInstallOutcome {
  const planCommand = input.suggest({ id: "deploy", flags: { dryRun: true } });
  const statusCommand = input.suggest({ id: "status" });
  const verifyActions = [
    ...(input.includeInstallCommand ? [`Install dependencies: ${input.installCommand}`] : []),
    `Start your project: ${input.devCommand} (then open ${input.issuer}/register)`,
    verifyLoginAction(),
  ];
  const boxActions: BoxAction[] = [
    ...(input.includeInstallCommand
      ? [
          {
            text: "Setup did not install the new dependencies, so install them first:",
            command: input.installCommand,
          },
        ]
      : []),
    {
      text: `Start your project (then open ${input.issuer}/register):`,
      command: input.devCommand,
    },
    { text: verifyLoginAction() },
    // The dev server holds the terminal it starts in, and every later command
    // reads `.zitadel/` from this directory.
    {
      text: "The dev server keeps its terminal busy. Open a second terminal in this directory for further commands.",
    },
    {
      text: "Once login works, this shows your next steps:",
      command: statusCommand,
    },
    { text: "Customizing the login is covered in your README's Zitadel section." },
  ];
  return {
    install: input.install,
    devCommand: input.devCommand,
    boxActions,
    nextActions: [...verifyActions, ...customizeAndPublishActions(input.suggest)],
    // The status command is in the box's steps, so a script gets it too.
    nextCommands: input.includeInstallCommand
      ? [
          shellCommand(input.installCommand),
          shellCommand(input.devCommand),
          planCommand,
          statusCommand,
        ]
      : [shellCommand(input.devCommand), planCommand, statusCommand],
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
    details: {
      command: installCommand.display,
      cwd,
      original: errorShape(error),
    },
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
