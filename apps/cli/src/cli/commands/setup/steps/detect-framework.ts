import type { Questions } from "@/lib/ui";
import {
  type SetupRetryOptions,
  retryOptionsOf,
  setupRetryFlags,
} from "@/cli/commands/setup/shared";
import type { Orca, ScaffoldTarget } from "@/lib/orca";

import { createOrca, inspectScaffoldTarget } from "@/lib/orca";
import { ZitadelError } from "@/lib/errors";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { WizardStep } from "@/lib/wizard";

import type { Fact, SetupServices } from "@/cli/commands/setup/shared";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags">;

/**
 * Finds the app the questions are about: the one detected here, or else a new
 * one.
 *
 * @remarks
 * Setup creates a new app only once it has every answer, just before it patches
 * it, so cancelling a question leaves the directory as it was, and a dry run
 * never creates one. Until then only its framework and dev port are known.
 */
export class DetectFramework extends WizardStep<
  "detect",
  Fact<"orca" | "found" | "scaffoldedFramework">,
  Needs,
  SetupServices
> {
  readonly key = "detect";

  /**
   * Detect the framework, or plan the one to scaffold.
   *
   *
   * @remarks
   * A new app, created below, or on a dry run only previewed.
   *
   * @param needs - The flags.
   * @param services - What the command provides.
   * @returns What was found.
   * @throws {@link ZitadelError} When no framework is found and the directory
   *   cannot be scaffolded into, or no framework was chosen.
   */
  async run(
    needs: Needs,
    services: SetupServices,
  ): Promise<Fact<"orca" | "found" | "scaffoldedFramework">> {
    const flags = needs.flags;
    const orca = createOrca();
    const detecting = services.ui.begin(
      `Detecting framework in ${escapeControlCharacters(shortPath(services.cwd, services.env))}`,
    );
    const found = await orca
      .detect(services.cwd, flags.framework)
      .then((facts) => {
        detecting.done(
          `Detected ${orca.displayName(facts.id)}${facts.devPort ? ` (dev port ${facts.devPort})` : ""}`,
        );
        return {
          app: {
            framework: facts.id,
            devPort: facts.devPort,
          },
          detected: facts,
          scaffoldedBesideFiles: false,
        };
      })
      .catch(async (error) => {
        if (!(error instanceof ZitadelError && error.code === "E_FRAMEWORK_NOT_DETECTED")) {
          detecting.fail();
          throw error;
        }
        const target = await inspectScaffoldTarget(services.cwd);
        if (!target.scaffoldable && !services.force) {
          detecting.fail();
          throw frameworkDetectionWithScaffoldTarget(error, services.cwd, target);
        }
        detecting.done(
          target.scaffoldable
            ? "Fresh app directory — setup scaffolds a new project"
            : "Non-empty directory with --force — setup scaffolds a new project",
        );
        return {
          app: await orca.planScaffold(
            services.cwd,
            await resolveScaffoldFramework(flags.framework, services.nonInteractive, orca, {
              retry: retryOptionsOf(flags),
              serverFlag: services.serverFlag,
              ask: services.ask,
            }),
          ),
          detected: undefined,
          scaffoldedBesideFiles: !target.scaffoldable,
        };
      });
    const scaffoldedFramework = found.detected === undefined;
    services.frameworkResolved({
      flags,
      found,
      scaffoldedFramework,
    });
    return {
      orca,
      found,
      scaffoldedFramework,
    };
  }
}

function frameworkDetectionWithScaffoldTarget(
  error: ZitadelError,
  cwd: string,
  target: ScaffoldTarget,
): ZitadelError {
  return new ZitadelError(
    error.code,
    "Could not detect a supported app framework, and this directory is not empty",
    {
      hint:
        `${target.reason ?? "Directory is not empty."} ` +
        "Pass --force to scaffold into this non-empty directory, run setup from an empty directory, or run setup from an existing supported app project.",
      details: {
        cwd,
        entries: target.entries,
        reason: target.reason,
      },
    },
  );
}

/**
 * Resolves which framework to scaffold into an empty directory: the explicit
 * `--framework`, else PickFrameworkPrompt, else a hard error in non-interactive
 * mode (an agent must pass `--framework`).
 */
async function resolveScaffoldFramework(
  framework: string | undefined,
  nonInteractive: boolean,
  orca: Orca,
  guidance: { retry: SetupRetryOptions; serverFlag?: string; ask: Questions },
): Promise<string> {
  if (framework) {
    return framework;
  }
  if (nonInteractive) {
    // Most often a coding agent or CI: no terminal, and no flag saying so. So
    // the error names every choice instead of pointing at a prompt it can't
    // see, and for a local server hands over the exact rerun. Only then:
    // `setupRetryFlags` pins `--server local`.
    const choices = orca.availableFrameworks().map((choice) => {
      return choice.id;
    });
    const suggested = choices.includes("next") ? "next" : choices[0];
    throw new ZitadelError("E_FRAMEWORK_NOT_DETECTED", "Empty directory — pass --framework", {
      hint: (
        "Setup asks which framework to scaffold only in a terminal. Without one, or with " +
        `--json or --non-interactive, pass --framework with one of: ${choices.join(", ")}.`
      ).trimEnd(),
      nextCommands:
        guidance.serverFlag === "local" && suggested
          ? [
              {
                id: "setup",
                flags: setupRetryFlags({
                  ...guidance.retry,
                  framework: suggested,
                }),
              },
            ]
          : [],
      details: { frameworks: choices },
    });
  }
  return new PickFrameworkPrompt().ask(orca.availableFrameworks(), guidance.ask);
}

/**
 * "Which framework would you like to scaffold?" — the only prompt outside the main wizard.
 * Runs at the empty-directory branch (before any other detection). Returns the chosen framework id; choices come from
 * `Orca.availableFrameworks`.
 */
export class PickFrameworkPrompt {
  async ask(
    choices: ReadonlyArray<{ id: string; displayName: string }>,
    ask: Questions,
  ): Promise<string> {
    return ask.select({
      name: "framework",
      message: "Which framework would you like to scaffold?",
      options: choices.map((choice) => {
        return {
          value: choice.id,
          label: choice.displayName,
        };
      }),
    });
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
