import type { Fact, SetupServices } from "@/cli/commands/setup/shared";
import { log, warnings, type BoxAction } from "@/lib/ui";
import { ZitadelError, ZitadelLibError } from "@/lib/errors";
import {
  type DependencyInstall,
  type InstallContext,
  PM,
  PmCommandFailedError,
  PmError,
  type Runner,
} from "@/lib/pm";
import { Guidance, suggestedCommandOf, type SuggestedCommand } from "@/lib/suggestion";
import { WizardStep } from "@/lib/wizard";

/**
 * How many of a failed after-install script's last output lines its warning quotes.
 */
const QUOTED_OUTPUT_LINES = 20;

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags" | "orca" | "app" | "patched" | "scaffoldedFramework" | "issuer">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "cwd" | "dryRun" | "env" | "isJson" | "signal" | "suggest" | "ui"> &
  Readonly<{
    /**
     * Runs a package manager's command, when something other than the real one should.
     */
    run?: Runner;
  }>;

/**
 * What installing did, and what the reader runs next.
 */
export type SetupInstallOutcome = Readonly<{
  /**
   * What the install came to.
   */
  install: DependencyInstall;

  /**
   * The command that starts the app, as the reader runs it.
   */
  devCommand: string;

  /**
   * Journey-staged subset for the human terminal box: the verify mission
   * plus one breadcrumb to `status`/README. Customize/publish guidance stays
   * out until login demonstrably works. Structured so the box renderer can
   * pull each command onto its own styled line; the envelope strings below
   * stay plain prose.
   */
  boxActions: readonly BoxAction[];

  /**
   * Complete journey for the JSON envelope — agents consume all of it.
   */
  nextActions: readonly string[];

  /**
   * The commands the reader runs next.
   */
  nextCommands: readonly SuggestedCommand[];
}>;

/**
 * Installs the dependencies the patch added to the app.
 */
export class InstallDependencies extends WizardStep<"install", Fact<"installOutcome">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "install";

  /**
   * What the command gives the step.
   */
  private readonly deps: Deps;

  /**
   * @param deps - What the command gives the step.
   */
  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Install, or say what a dry run would.
   *
   * @remarks
   * Installs what setup added, with the package manager the project already uses, and reports
   * what a reader runs next. A run that scaffolded nothing and added no dependency installs
   * nothing, and `--skip-install` leaves the install to the reader while still naming the
   * command. After an install it runs the script the new app's scaffolder names, and none for an
   * app that was already there, whose scripts setup does not know.
   *
   * What the reader runs, from the shell's directory; setup itself runs the plain commands in the
   * project directory. The suggested install and dev commands name the directory when `--cwd` was
   * typed, as every other follow-up carries it; run from the shell's own directory they would act
   * on whatever project is there. The follow-ups are rendered for the run, pinned to the project
   * setup just created: without that a bare `status` or `deploy` resolves the environment as the
   * next shell does, where the process environment outranks the `.env` files, and in a shell
   * holding production values the follow-up would read, or publish to, another project.
   *
   * The after-install script runs as one step, its output kept back (a production build's log,
   * whose last line reads like a next step) and quoted only when it fails. A failure is a warning:
   * the app works without what the script writes, and the framework writes that on its first dev
   * run. Ctrl-C is not a failure: it stops setup before its commit. The install is drawn as a
   * step of the command's own chain, so it sits with every other one setup reports.
   *
   * The box carries the install command only when the install did not run, and the dev server holds
   * the terminal it starts in, and every later command reads `.zitadel/` from this directory. The
   * status command is in the box's steps, so a script gets it too.
   *
   * @param needs - The flags, the app and what the patch added.
   * @returns What installing did, and what the reader runs next.
   * @throws {@link ZitadelError} When the install fails, or the run is cancelled during the
   *   after-install script.
   */
  async run(needs: Needs): Promise<Fact<"installOutcome">> {
    const { app, flags, issuer, orca, patched, scaffoldedFramework } = needs;
    const afterInstallScript = scaffoldedFramework
      ? orca.scaffolderFor(app.framework).afterInstallScript
      : undefined;
    const packageManager = await PM.detect(this.deps.cwd);
    const devCommand = packageManager.dev();
    const shownInstall = suggestedCommandOf(
      packageManager.install().inDirectory(flags.cwd, this.deps.cwd),
    );
    const shownDev = suggestedCommandOf(devCommand.inDirectory(flags.cwd, this.deps.cwd));
    const context: InstallContext = {
      cwd: this.deps.cwd,
      env: this.deps.env,
      json: this.deps.isJson,
      task: (label, work, done) => {
        return this.deps.ui.task(label, work, done);
      },
      log,
      failed: (error, installCommand) => {
        const original =
          error instanceof PmError
            ? {
                name: error.name,
                message: error.message,
                code: error.code,
              }
            : error instanceof ZitadelLibError
              ? {
                  name: error.name,
                  message: error.message,
                }
              : {
                  message: String(error),
                };
        return new ZitadelError(
          "E_VALIDATION",
          `Dependency install failed: ${installCommand.display}`,
          {
            hint: `Run ${installCommand.display} in ${this.deps.cwd}, then start the app with ${devCommand.display}.`,
            nextCommands: [shownInstall],
            details: {
              command: installCommand.display,
              cwd: this.deps.cwd,
              original,
            },
          },
        );
      },
      ...(this.deps.run === undefined ? {} : { run: this.deps.run }),
    };
    const { install } = await packageManager.installDependencies(
      {
        needed: scaffoldedFramework || patched.depsAdded.length > 0,
        dryRun: this.deps.dryRun,
        skipInstall: Boolean(flags.skipInstall),
      },
      context,
    );
    if (install.status === "completed" && afterInstallScript !== undefined) {
      const command = packageManager.script(afterInstallScript);
      await this.deps.ui
        .task(
          `Running ${command.display}`,
          async () => {
            const options = {
              cwd: this.deps.cwd,
              env: this.deps.env,
              captureOutput: true,
            };
            await (this.deps.run === undefined
              ? command.run(options)
              : this.deps.run(command, options));
          },
          () => {
            return `Ran ${command.display}`;
          },
        )
        .catch((error: unknown) => {
          if (this.deps.signal.aborted) {
            throw this.deps.signal.reason;
          }
          if (error instanceof PmCommandFailedError) {
            const output = error.output ?? "";
            const quoted =
              output.trim() === ""
                ? ""
                : `\n${output.trimEnd().split("\n").slice(-QUOTED_OUTPUT_LINES).join("\n")}`;
            warnings.report(
              `${suggestedCommandOf(command.inDirectory(flags.cwd, this.deps.cwd))} failed after the install, so setup's commit may leave out the files it writes; run it, then commit them: ${error.message}${quoted}`,
            );
            return;
          }
          if (error instanceof PmError) {
            warnings.report(
              `${suggestedCommandOf(command.inDirectory(flags.cwd, this.deps.cwd))} failed after the install, so setup's commit may leave out the files it writes; run it, then commit them: ${error.message}`,
            );
            return;
          }
          throw error;
        });
    }
    const includeInstallCommand = install.status === "would-run" || install.status === "skipped";
    const planCommand = this.deps.suggest({
      id: "deploy",
      flags: { dryRun: true },
    });
    const statusCommand = this.deps.suggest({ id: "status" });
    return {
      installOutcome: {
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
            text: `Start your project (then open ${issuer}/register):`,
            command: shownDev,
          },
          { text: Guidance.verifyLogin() },
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
          ...(includeInstallCommand ? [`Install dependencies: ${shownInstall}`] : []),
          `Start your project: ${shownDev} (then open ${issuer}/register)`,
          Guidance.verifyLogin(),
          ...new Guidance(this.deps.suggest).customizeAndPublish(),
        ],
        nextCommands: includeInstallCommand
          ? [shownInstall, shownDev, planCommand, statusCommand]
          : [shownDev, planCommand, statusCommand],
      },
    };
  }
}
