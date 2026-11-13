import type { BoxAction } from "@/lib/box";
import { ZitadelError } from "@/lib/errors";
import { type DependencyInstall, installDependencies } from "@/lib/install";
import { customizeAndPublishActions, verifyLoginAction } from "@/lib/journey-guidance";
import { log } from "@/lib/log";
import {
  detectPackageManager,
  devCommandFor,
  inDirectory,
  installCommandFor,
  type PackageCommand,
  runPackageCommand,
  runScriptCommandFor,
} from "@/lib/package-manager";
import { type Suggest, type SuggestedCommand, suggestedCommandOf } from "@/lib/suggestion";
import { reportWarning } from "@/lib/warnings";

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
   * The scaffolder's `afterInstallScript`, for an app setup scaffolded: run
   * once the install completes, and not at all when there was none.
   */
  afterInstallScript?: string | undefined;
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
 * install to the reader while still naming the command. After an install it
 * runs the new app's {@link SetupInstallInput.afterInstallScript}.
 */
export async function installDependenciesForSetup(
  input: SetupInstallInput,
): Promise<SetupInstallOutcome> {
  const packageManager = await detectPackageManager(input.cwd);
  const devCommand = devCommandFor(packageManager);
  // What the reader runs, from the shell's directory; setup itself runs the
  // plain commands in `cwd`.
  const shownInstall = suggestedCommandOf(
    inDirectory(installCommandFor(packageManager), input.cwdFlag, input.cwd),
  );
  const shownDev = suggestedCommandOf(inDirectory(devCommand, input.cwdFlag, input.cwd));
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
  if (install.status === "completed" && input.afterInstallScript !== undefined) {
    await runAfterInstallScript(
      runScriptCommandFor(packageManager, input.afterInstallScript),
      input,
    );
  }

  return outcome({
    install,
    devCommand: shownDev,
    installCommand: shownInstall,
    issuer: input.issuer,
    suggest: input.suggest,
    includeInstallCommand: install.status === "would-run" || install.status === "skipped",
  });
}

/**
 * Runs the new app's after-install script. A failure is a warning: the app
 * works without what it writes, and the framework writes that on its first
 * dev run, only after setup's commit.
 */
async function runAfterInstallScript(
  command: PackageCommand,
  input: SetupInstallInput,
): Promise<void> {
  const label = `Running ${command.display}`;
  const work = async (): Promise<void> => {
    await (input.run ?? runPackageCommand)(command, {
      cwd: input.cwd,
      env: input.env,
      redirectStdoutToStderr: input.json,
    });
  };
  try {
    if (input.json) {
      await input.task(label, work, () => {
        return `Ran ${command.display}`;
      });
    } else {
      // The script writes to the terminal itself, as the install does.
      log.start(label);
      await work();
      log.done(`Ran ${command.display}`);
    }
  } catch (error) {
    reportWarning(
      `${command.display} failed after the install, so setup's commit leaves out the files it writes; run it, then commit them: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function outcome(input: {
  install: SetupInstall;
  devCommand: SuggestedCommand;
  /** {@link SetupInstall.command} as the reader runs it. */
  installCommand: SuggestedCommand;
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
      ? [input.installCommand, input.devCommand, planCommand, statusCommand]
      : [input.devCommand, planCommand, statusCommand],
  };
}

function installFailed(
  error: unknown,
  installCommand: PackageCommand,
  devCommand: PackageCommand,
  shownInstall: SuggestedCommand,
  cwd: string,
): ZitadelError {
  return new ZitadelError("E_VALIDATION", `Dependency install failed: ${installCommand.display}`, {
    hint: `Run ${installCommand.display} in ${cwd}, then start the app with ${devCommand.display}.`,
    nextCommands: [shownInstall],
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
