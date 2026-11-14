import { WizardStep } from "@/lib/wizard";

import type { Fact, SetupServices } from "@/cli/commands/setup/shared";
import type { BoxAction } from "@/lib/box";
import { ZitadelError } from "@/lib/errors";
import { type DependencyInstall, installDependencies } from "@/lib/install";
import { customizeAndPublishActions, verifyLoginAction } from "@/lib/journey-guidance";
import type { Orca } from "@/lib/orca";
import {
  detectPackageManager,
  devCommandFor,
  inDirectory,
  installCommandFor,
  runPackageCommand,
  runScriptCommandFor,
} from "@/lib/package-manager";
import { type Suggest, type SuggestedCommand, suggestedCommandOf } from "@/lib/suggestion";
import { reportWarning } from "@/lib/warnings";

/** How many of a failed after-install script's last output lines its warning quotes. */
const QUOTED_OUTPUT_LINES = 20;

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags" | "orca" | "app" | "patched" | "scaffoldedFramework" | "issuer">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "cwd" | "dryRun" | "env" | "isJson" | "signal" | "suggest" | "ui">;

/**
 * Installs the dependencies the patch added to the app.
 */
export class InstallDependencies extends WizardStep<"install", Fact<"installOutcome">, Needs> {
  readonly key = "install";

  /**
   * @param deps - What the command gives the step.
   */
  private readonly deps: Deps;

  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Install, or say what a dry run would.
   *
   * @param needs - The flags, the app and what the patch added.
   * @param this.deps - What the command provides.
   * @returns What installing did.
   */
  async run(needs: Needs): Promise<Fact<"installOutcome">> {
    const { app, flags, issuer, orca, patched, scaffoldedFramework } = needs;
    const installOutcome = await installDependenciesForSetup({
      cwd: this.deps.cwd,
      ...(flags.cwd === undefined ? {} : { cwdFlag: flags.cwd }),
      depsAdded: patched.depsAdded,
      dryRun: this.deps.dryRun,
      env: this.deps.env,
      issuer,
      json: this.deps.isJson,
      suggest: this.deps.suggest,
      scaffoldedFramework,
      skipInstall: Boolean(flags.skipInstall),
      afterInstallScript: afterInstallScriptFor(orca, app.framework, scaffoldedFramework),
      signal: this.deps.signal,
      task: (label, work, done) => {
        return this.deps.ui.task(label, work, done);
      },
    });
    return {
      installOutcome,
    };
  }
}

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
   * {@link afterInstallScriptFor} the app: run once the install completes,
   * and not at all when there was none.
   */
  afterInstallScript?: string | undefined;
  /** The run's Ctrl-C; a cancelled after-install script stops setup. */
  signal: AbortSignal;
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
 *
 * @remarks
 * What the reader runs, from the shell's directory; setup itself runs the plain commands in `cwd`.
 *
 * The after-install script runs as one step, its output kept back (a production build's log,
 * whose last line reads like a next step) and quoted only when it fails. A failure is a warning:
 * the app works without what the script writes, and the framework writes that on its first dev
 * run. Ctrl-C is not a failure: it stops setup before its commit.
 *
 * The box carries the install command only when the install did not run, and the dev server holds
 * the terminal it starts in, and every later command reads `.zitadel/` from this directory. The
 * status command is in the box's steps, so a script gets it too.
 *
 * @param input - What the run knows and how it draws.
 * @returns What installing did, and what the reader runs next.
 * @throws {@link ZitadelError} When the install fails, or the run is cancelled during the
 *   after-install script.
 */
export async function installDependenciesForSetup(
  input: SetupInstallInput,
): Promise<SetupInstallOutcome> {
  const packageManager = await detectPackageManager(input.cwd);
  const devCommand = devCommandFor(packageManager);
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
      return new ZitadelError(
        "E_VALIDATION",
        `Dependency install failed: ${installCommand.display}`,
        {
          hint: `Run ${installCommand.display} in ${input.cwd}, then start the app with ${devCommand.display}.`,
          nextCommands: [shownInstall],
          details: {
            command: installCommand.display,
            cwd: input.cwd,
            original:
              error instanceof Error
                ? {
                    name: error.name,
                    message: error.message,
                    code: (error as NodeJS.ErrnoException).code,
                  }
                : {
                    message: String(error),
                  },
          },
        },
      );
    },
    ...(input.run === undefined ? {} : { run: input.run }),
  });
  if (install.status === "completed" && input.afterInstallScript !== undefined) {
    const command = runScriptCommandFor(packageManager, input.afterInstallScript);
    try {
      await input.task(
        `Running ${command.display}`,
        async () => {
          await (input.run ?? runPackageCommand)(command, {
            cwd: input.cwd,
            env: input.env,
            captureOutput: true,
          });
        },
        () => {
          return `Ran ${command.display}`;
        },
      );
    } catch (error) {
      if (input.signal.aborted) {
        throw input.signal.reason;
      }
      const output = (error as { output?: unknown }).output;
      reportWarning(
        `${suggestedCommandOf(inDirectory(command, input.cwdFlag, input.cwd))} failed after the install, so setup's commit may leave out the files it writes; run it, then commit them: ${error instanceof Error ? error.message : String(error)}${
          typeof output === "string" && output.trim() !== ""
            ? `\n${output.trimEnd().split("\n").slice(-QUOTED_OUTPUT_LINES).join("\n")}`
            : ""
        }`,
      );
    }
  }

  const includeInstallCommand = install.status === "would-run" || install.status === "skipped";
  const planCommand = input.suggest({
    id: "deploy",
    flags: { dryRun: true },
  });
  const statusCommand = input.suggest({ id: "status" });
  return {
    install,
    devCommand: shownDev,
    boxActions: [
      ...(includeInstallCommand
        ? [
            {
              text: "Setup did not install the new dependencies, so install them first:",
              command: shownInstall,
            },
          ]
        : []),
      {
        text: `Start your project (then open ${input.issuer}/register):`,
        command: shownDev,
      },
      { text: verifyLoginAction() },
      {
        text: "The dev server keeps its terminal busy. Open a second terminal in this directory for further commands.",
      },
      {
        text: "Once login works, this shows your next steps:",
        command: statusCommand,
      },
      { text: "Customizing the login is covered in your README's Zitadel section." },
    ],
    nextActions: [
      ...[
        ...(includeInstallCommand ? [`Install dependencies: ${shownInstall}`] : []),
        `Start your project: ${shownDev} (then open ${input.issuer}/register)`,
        verifyLoginAction(),
      ],
      ...customizeAndPublishActions(input.suggest),
    ],
    nextCommands: includeInstallCommand
      ? [shownInstall, shownDev, planCommand, statusCommand]
      : [shownDev, planCommand, statusCommand],
  };
}

/**
 * The after-install script setup runs for an app: the one its scaffolder names
 * when setup scaffolded it, and none for an app that was already there, whose
 * scripts setup does not know.
 *
 * @param orca - What knows the scaffolders.
 * @param framework - The app's framework.
 * @param scaffolded - Whether setup scaffolded the app.
 * @returns The script, or `undefined` when there is none to run.
 */
export function afterInstallScriptFor(
  orca: Pick<Orca, "scaffolderFor">,
  framework: string,
  scaffolded: boolean,
): string | undefined {
  return scaffolded ? orca.scaffolderFor(framework).afterInstallScript : undefined;
}
