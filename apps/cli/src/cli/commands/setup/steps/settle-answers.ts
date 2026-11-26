import type { Fact, SetupServices } from "@/cli/commands/setup/shared";
import type { TcpListener } from "@/lib/server";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { warnings } from "@/lib/ui";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags" | "answers">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "cwd" | "dryRun" | "machine" | "nonInteractive" | "suggest">;

/**
 * Closes the questions: says so when a run that asked nothing still pins the dev
 * script to a port something else holds, and records what was settled.
 */
export class SettleAnswers extends WizardStep<"settle", object, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "settle";

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
   * Warn about a port something else holds, and record the answers.
   *
   * @remarks
   * The wizard asks for another port when the detected one is taken. A run that asks nothing still
   * pins the dev script to it, so it says so, with the command that puts the app on a free one.
   * With no free port among the next ones the warning names only the flag: a placeholder in a
   * suggested command is a shell redirection.
   *
   * A port held by a process running in the app's folder is the app's own dev server, which is
   * where the app should stay, so it is not warned about: an agent told to move would set the app
   * up on a port its running dev server does not serve. A holder this machine can name runs
   * elsewhere, so the warning names it; one it cannot name might still be the app's, so the
   * warning leaves that to the reader.
   *
   * @param needs - The flags and the answers.
   * @returns Nothing is added.
   */
  async run(needs: Needs): Promise<object> {
    const { answers, flags } = needs;
    if (!(this.deps.nonInteractive || this.deps.dryRun) || flags.devPort !== undefined) {
      return {};
    }
    const holder = await this.deps.machine.portHolder(answers.devPort, this.deps.cwd);
    if (holder.kind !== "other") {
      return {};
    }
    const free = await this.deps.machine.nextFreePort(answers.devPort);
    warnings.report(
      portWarning(
        answers.devPort,
        holderNames(holder.listeners),
        free === undefined
          ? undefined
          : this.deps.suggest({
              id: "setup",
              flags: { devPort: free },
            }),
      ),
    );
    return {};
  }
}

/**
 * The warning about a port something other than the app holds.
 *
 * @param port - The port the dev script is pinned to.
 * @param holders - Who holds it, when this machine could name them.
 * @param move - The setup that puts the app on the next free port, when one is free.
 * @returns The warning.
 */
function portWarning(port: number, holders: string | undefined, move: string | undefined): string {
  if (holders === undefined) {
    return move === undefined
      ? `Port ${port} and the ports after it are already in use. If that is not this app's dev server, run setup with --dev-port and a free port.`
      : `Port ${port} is already in use. If that is not this app's dev server, run setup with a free port: ${move}`;
  }
  return move === undefined
    ? `Port ${port} and the ports after it are already in use, port ${port} by ${holders}, which runs outside this app's folder. Stop it, or run setup with --dev-port and a free port.`
    : `Port ${port} is already in use by ${holders}, which runs outside this app's folder. Stop it, or run setup with a free port: ${move}`;
}

/**
 * The processes holding a port, as a reader finds them in `ps` or `lsof`: `node (pid 4242)`.
 *
 * @param listeners - The processes listening on the port; one listening on two addresses is named
 *   once.
 * @returns Their names, or `undefined` when none could be named.
 */
function holderNames(listeners: readonly TcpListener[]): string | undefined {
  const names = [
    ...new Set(
      listeners.flatMap((listener) => {
        return listener.pid === undefined
          ? []
          : [`${escapeControlCharacters(listener.command ?? "a process")} (pid ${listener.pid})`];
      }),
    ),
  ];
  return names.length === 0 ? undefined : names.join(", ");
}
