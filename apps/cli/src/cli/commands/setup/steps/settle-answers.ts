import type { Suggest } from "@/lib/suggestion";

import { LocalServer } from "@/lib/local-server/server";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";

import type { Fact, SetupServices } from "@/cli/commands/setup/shared";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags" | "answers">;

/**
 * Closes the questions: says so when a run that asked nothing still pins the dev
 * script to a port something holds, and records what was settled.
 */
export class SettleAnswers extends WizardStep<"settle", object, Needs, SetupServices> {
  readonly key = "settle";

  /**
   * Warn about a taken port, and record the answers.
   *
   *
   * @remarks
   * The wizard asks for another port when the detected one is taken. A run that asks nothing still
   * pins the dev script to it, so it says so, with the command that puts the app on a free one.
   *
   * @param needs - The flags and the answers.
   * @param services - What the command provides.
   * @returns Nothing is added.
   */
  async run(needs: Needs, services: SetupServices): Promise<object> {
    const { answers, flags } = needs;
    const asks = !services.nonInteractive && !services.dryRun;
    if (!asks && flags.devPort === undefined && !(await LocalServer.isPortFree(answers.devPort))) {
      reportWarning(
        portInUseWarning(
          answers.devPort,
          await LocalServer.nextFreePort(answers.devPort),
          services.suggest,
        ),
      );
    }
    services.answersSettled(answers);
    return {};
  }
}

/**
 * What a run that cannot ask says about a taken app port, with the command
 * that moves the app to `free`. With no free port among the next ones it names
 * only the flag: a placeholder in a suggested command is a shell redirection.
 */
export function portInUseWarning(port: number, free: number | undefined, suggest: Suggest): string {
  return free === undefined
    ? `Port ${port} and the ports after it are already in use. If that is not this app's dev server, run setup with --dev-port and a free port.`
    : `Port ${port} is already in use. If that is not this app's dev server, run setup with a free port: ${suggest(
        {
          id: "setup",
          flags: { devPort: free },
        },
      )}`;
}
