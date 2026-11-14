import { toZitadelError } from "@/lib/errors";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { reportWarning } from "@/lib/warnings";

import { WizardStep } from "@/lib/wizard";

import type { Fact, SetupServices } from "@/cli/commands/setup/shared";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"orca" | "found" | "app" | "answers" | "issuer">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "cwd" | "dryRun" | "env" | "force" | "ui">;

/**
 * Creates the new app, when the run makes one, now that every answer is in
 * hand. A dry run creates none, so it has no app to patch.
 *
 * @remarks
 * A new app is kept only once its default resources are in place. A failure
 * before that, Ctrl-C included, removes it again and puts back what the
 * directory held, so the rerun scaffolds a new app instead of taking a
 * half-set-up one for an app the developer brought.
 */
export class ScaffoldApp extends WizardStep<"scaffold", Fact<"newApp" | "framework">, Needs> {
  readonly key = "scaffold";

  /**
   * @param deps - What the command gives the step.
   */
  private readonly deps: Deps;

  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Scaffold the app, or say that a dry run would.
   *
   * @remarks
   * The ChooseDevPort can change the port interactively, so the answer is folded back into the
   * framework: the patched dev-server config reads `framework.devPort`, and it must agree with the
   * issuer and the registered origin (both derived from `answers.devPort`).
   *
   * @param needs - What detection found and what was answered.
   * @returns The new app, and the app the patch works on.
   */
  async run(needs: Needs): Promise<Fact<"newApp" | "framework">> {
    const { answers, app, found, issuer, orca } = needs;
    const { detected } = found;
    const scaffolding = detected === undefined && !this.deps.dryRun;
    if (detected === undefined && this.deps.dryRun) {
      this.deps.ui
        .begin(`Scaffolding a new ${app.framework} project (dry run)`)
        .done(`Would scaffold a new ${app.framework} project (dry run)`);
    }
    const current = scaffolding
      ? this.deps.ui.begin(`Scaffolding a new ${app.framework} project`)
      : undefined;
    const newApp = scaffolding
      ? await orca
          .scaffoldUndoably(this.deps.cwd, app.framework, this.deps.force)
          .catch((error) => {
            current?.fail();
            throw error;
          })
      : undefined;
    if (newApp !== undefined) {
      current?.done(`Scaffolded ${newApp.facts.id} skeleton`);
    }
    const created = detected ?? newApp?.facts;
    return {
      newApp,
      framework:
        created === undefined
          ? undefined
          : {
              ...created,
              devPort: answers.devPort,
              url: issuer,
            },
    };
  }

  /**
   * Remove the new app again and put back what the directory held.
   *
   * @remarks
   * A failure to do so is reported, not thrown: the error that stopped setup is the one the
   * developer needs. The directory is shown with the user's `$HOME` as `~` for compact terminal
   * output, falling back to the raw path when `HOME` isn't set or doesn't match. The environment
   * is the run's, not the process's, so a run told what its environment is reads the same one
   * everywhere.
   *
   * @param out - The new app.
   * @param _needs - What was known when the step ran.
   * @returns Once it is removed.
   */
  override async undo(out: Fact<"newApp" | "framework">): Promise<void> {
    if (out.newApp !== undefined) {
      try {
        await out.newApp.undo();
        const home = this.deps.env.HOME;
        this.deps.ui.say(
          `Removed the new app, so ${escapeControlCharacters(
            home && this.deps.cwd.startsWith(home)
              ? `~${this.deps.cwd.slice(home.length)}`
              : this.deps.cwd,
          )} holds what it did before setup`,
        );
      } catch (error) {
        reportWarning(
          `Could not remove the new app setup scaffolded in ${this.deps.cwd}: ${toZitadelError(error).message}`,
        );
      }
    }
  }
}
