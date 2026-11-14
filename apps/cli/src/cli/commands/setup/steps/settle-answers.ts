import { LocalServer } from "@/lib/local-server/server";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";

import type { Fact, SetupServices } from "@/cli/commands/setup/shared";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags" | "answers">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "dryRun" | "nonInteractive" | "suggest">;

/**
 * Closes the questions: says so when a run that asked nothing still pins the dev
 * script to a port something holds, and records what was settled.
 */
export class SettleAnswers extends WizardStep<"settle", object, Needs> {
  readonly key = "settle";

  /**
   * @param deps - What the command gives the step.
   */
  private readonly deps: Deps;

  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Warn about a taken port, and record the answers.
   *
   * @remarks
   * The wizard asks for another port when the detected one is taken. A run that asks nothing still
   * pins the dev script to it, so it says so, with the command that puts the app on a free one.
   * With no free port among the next ones the warning names only the flag: a placeholder in a
   * suggested command is a shell redirection.
   *
   * @param needs - The flags and the answers.
   * @returns Nothing is added.
   */
  async run(needs: Needs): Promise<object> {
    const { answers, flags } = needs;
    if (
      (this.deps.nonInteractive || this.deps.dryRun) &&
      flags.devPort === undefined &&
      !(await LocalServer.isPortFree(answers.devPort))
    ) {
      const free = await LocalServer.nextFreePort(answers.devPort);
      reportWarning(
        free === undefined
          ? `Port ${answers.devPort} and the ports after it are already in use. If that is not this app's dev server, run setup with --dev-port and a free port.`
          : `Port ${answers.devPort} is already in use. If that is not this app's dev server, run setup with a free port: ${this.deps.suggest(
              {
                id: "setup",
                flags: { devPort: free },
              },
            )}`,
      );
    }
    return {};
  }
}
