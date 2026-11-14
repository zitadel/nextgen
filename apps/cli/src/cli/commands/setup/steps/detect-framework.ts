import type { Fact, SetupServices } from "@/cli/commands/setup/shared";
import { retryOptionsFromFlags, setupRetryFlags } from "@/cli/commands/setup/shared";

import { createOrca, inspectScaffoldTarget } from "@/lib/orca";
import { ZitadelError } from "@/lib/errors";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<
  SetupServices,
  "ask" | "cwd" | "env" | "force" | "nonInteractive" | "serverFlag" | "ui"
>;

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
  Needs
> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "detect";

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
   * Detect the framework, or plan the one to scaffold.
   *
   * @remarks
   * A new app is created later, or on a dry run only previewed.
   *
   * The path is shown with the user's `$HOME` as `~` for compact terminal output, falling back to
   * the raw path when `HOME` isn't set or doesn't match. The environment is the run's, not the
   * process's, so a run told what its environment is reads the same one everywhere.
   *
   * When no framework is detected and the directory cannot be scaffolded into, the error says so.
   * The framework to scaffold is the explicit `--framework`, else the prompt, else a hard error in
   * non-interactive mode: an agent must pass `--framework`. That error is most often met by a
   * coding agent or CI: no terminal, and no flag saying so. So it names every choice instead of
   * pointing at a prompt it can't see, and for a local server hands over the exact rerun. Only
   * then: `setupRetryFlags` pins `--server local`.
   *
   * The framework is asked about in the only prompt outside the main wizard: it runs at the
   * empty-directory branch, before any other detection, and its choices are
   * `Orca.availableFrameworks`.
   *
   * @param needs - The flags.
   * @returns What was found.
   * @throws {@link ZitadelError} When no framework is found and the directory
   *   cannot be scaffolded into, or no framework was chosen.
   */
  async run(needs: Needs): Promise<Fact<"orca" | "found" | "scaffoldedFramework">> {
    const flags = needs.flags;
    const orca = createOrca();
    const home = this.deps.env.HOME;
    const detecting = this.deps.ui.begin(
      `Detecting framework in ${escapeControlCharacters(
        home && this.deps.cwd.startsWith(home)
          ? `~${this.deps.cwd.slice(home.length)}`
          : this.deps.cwd,
      )}`,
    );
    const found = await orca
      .detect(this.deps.cwd, flags.framework)
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
        const target = await inspectScaffoldTarget(this.deps.cwd);
        if (!target.scaffoldable && !this.deps.force) {
          detecting.fail();
          throw new ZitadelError(
            error.code,
            "Could not detect a supported app framework, and this directory is not empty",
            {
              hint:
                `${target.reason ?? "Directory is not empty."} ` +
                "Pass --force to scaffold into this non-empty directory, run setup from an empty directory, or run setup from an existing supported app project.",
              details: {
                cwd: this.deps.cwd,
                entries: target.entries,
                reason: target.reason,
              },
            },
          );
        }
        detecting.done(
          target.scaffoldable
            ? "Fresh app directory — setup scaffolds a new project"
            : "Non-empty directory with --force — setup scaffolds a new project",
        );
        if (!flags.framework && this.deps.nonInteractive) {
          const choices: readonly string[] = orca.availableFrameworks().map((choice) => {
            return choice.id;
          });
          const suggested = choices.includes("next") ? "next" : choices[0];
          throw new ZitadelError("E_FRAMEWORK_NOT_DETECTED", "Empty directory — pass --framework", {
            hint: (
              "Setup asks which framework to scaffold only in a terminal. Without one, or with " +
              `--json or --non-interactive, pass --framework with one of: ${choices.join(", ")}.`
            ).trimEnd(),
            nextCommands:
              this.deps.serverFlag === "local" && suggested
                ? [
                    {
                      id: "setup",
                      flags: setupRetryFlags({
                        ...retryOptionsFromFlags(flags),
                        framework: suggested,
                      }),
                    },
                  ]
                : [],
            details: { frameworks: choices },
          });
        }
        return {
          app: await orca.planScaffold(
            this.deps.cwd,
            flags.framework ||
              (await this.deps.ask.select({
                name: "framework",
                message: "Which framework would you like to scaffold?",
                options: orca.availableFrameworks().map((choice) => {
                  return {
                    value: choice.id,
                    label: choice.displayName,
                  };
                }),
              })),
          ),
          detected: undefined,
          scaffoldedBesideFiles: !target.scaffoldable,
        };
      });
    const scaffoldedFramework = found.detected === undefined;
    return {
      orca,
      found,
      scaffoldedFramework,
    };
  }
}
