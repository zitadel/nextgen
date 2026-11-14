import { toZitadelError } from "@/lib/errors";
import type { UndoableScaffold } from "@/lib/orca";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { reportWarning } from "@/lib/warnings";

import { WizardStep } from "@/lib/wizard";

import type { Fact, SetupServices } from "@/cli/commands/setup/shared";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"orca" | "found" | "app" | "answers" | "issuer">;

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
export class ScaffoldApp extends WizardStep<
  "scaffold",
  Fact<"newApp" | "framework">,
  Needs,
  SetupServices
> {
  readonly key = "scaffold";

  /**
   * Scaffold the app, or say that a dry run would.
   *
   * @param needs - What detection found and what was answered.
   * @param services - What the command provides.
   * @returns The new app, and the app the patch works on.
   */
  async run(needs: Needs, services: SetupServices): Promise<Fact<"newApp" | "framework">> {
    const { answers, app, found, issuer, orca } = needs;
    const { detected } = found;
    const scaffolding = detected === undefined && !services.dryRun;
    if (detected === undefined && services.dryRun) {
      services.ui
        .begin(`Scaffolding a new ${app.framework} project (dry run)`)
        .done(`Would scaffold a new ${app.framework} project (dry run)`);
    }
    const current = scaffolding
      ? services.ui.begin(`Scaffolding a new ${app.framework} project`)
      : undefined;
    const newApp = scaffolding
      ? await orca.scaffoldUndoably(services.cwd, app.framework, services.force).catch((error) => {
          current?.fail();
          throw error;
        })
      : undefined;
    if (newApp !== undefined) {
      current?.done(`Scaffolded ${newApp.facts.id} skeleton`);
    }
    const created = detected ?? newApp?.facts;
    // The ChooseDevPort can change the port interactively, so fold the answer
    // back into the framework: the patched dev-server config reads
    // `framework.devPort`, and it must agree with the issuer and the registered
    // origin (both derived from `answers.devPort`).
    const framework =
      created === undefined
        ? undefined
        : {
            ...created,
            devPort: answers.devPort,
            url: issuer,
          };
    return {
      newApp,
      framework,
    };
  }

  /**
   * Remove the new app again and put back what the directory held.
   *
   * @param out - The new app.
   * @param _needs - What was known when the step ran.
   * @param services - What the command provides.
   * @returns Once it is removed.
   */
  override async undo(
    out: Fact<"newApp" | "framework">,
    _needs: Needs,
    services: SetupServices,
  ): Promise<void> {
    if (out.newApp !== undefined) {
      await removeNewApp(out.newApp, services.cwd, services.env, (text) => {
        services.ui.say(text);
      });
    }
  }
}

/**
 * Removes a new app setup scaffolded but could not finish setting up, and puts
 * back what the directory held. A failure to do so is reported, not thrown:
 * the error that stopped setup is the one the developer needs.
 */
async function removeNewApp(
  newApp: UndoableScaffold,
  cwd: string,
  env: NodeJS.ProcessEnv,
  say: (text: string) => void,
): Promise<void> {
  try {
    await newApp.undo();
    say(
      `Removed the new app, so ${escapeControlCharacters(shortPath(cwd, env))} holds what it did before setup`,
    );
  } catch (error) {
    reportWarning(
      `Could not remove the new app setup scaffolded in ${cwd}: ${toZitadelError(error).message}`,
    );
  }
}

/**
 * Replaces the user's `$HOME` with `~` in a path for compact terminal output.
 * Falls back to the raw path when `HOME` isn't set or doesn't match. The
 * environment is the run's, not the process's, so a run told what its
 * environment is reads the same one everywhere.
 */
function shortPath(absolute: string, env: NodeJS.ProcessEnv): string {
  const home = env.HOME;
  if (home && absolute.startsWith(home)) {
    return `~${absolute.slice(home.length)}`;
  }
  return absolute;
}
