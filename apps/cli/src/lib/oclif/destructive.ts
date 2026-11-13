import type { Interfaces } from "@oclif/core";

import { Consent, type Gate } from "@/lib/consent";
import { CANCELLED } from "@/lib/errors";

import type { BaseCommand } from "./base";
import { Promptable } from "./promptable";
import type { CommandResult } from "./types";

/**
 * The flag every destructive command declares, which the retry a refused
 * confirmation suggests sets: the run again with `--force`. The mixin cannot
 * see its host's flags, so it names the one it relies on here, and the run
 * refuses the retry if the host does not declare it.
 */
type ConsentFlags = Readonly<{ force: Interfaces.BooleanFlag<boolean> }>;

/** A class that can be extended, abstract or not, whatever arguments it takes. */
// biome-ignore lint/suspicious/noExplicitAny: the constructor of any command, which a mixin cannot name
type CommandClass<T extends BaseCommand> = abstract new (...args: any[]) => T;

/** A result that ends a run before anyone is asked, from {@link DestructiveChange.prepare}. */
export class Settled {
  readonly result: CommandResult;

  constructor(result: CommandResult) {
    this.result = result;
  }
}

/** A destructive change: the question that guards it, and the change. */
export type DestructiveChange<Ready = undefined> = Omit<Gate, "message"> & {
  /**
   * The question as the prompt shows it. A function words it from what
   * `prepare` read, for a question that names the project and server the
   * change is made on, which only the connection knows.
   */
  message: string | ((ready: Ready) => string | Promise<string>);
  /** The result of a dry run, which never asks, never reads and never acts. */
  preview: () => CommandResult | Promise<CommandResult>;
  /**
   * What the change reads before anyone is asked, and a dry run never does:
   * the connection, so a missing value is asked for before the question, or
   * the guard a write sends. A {@link Settled} ends the run with its result,
   * for a change that has nothing to do.
   */
  prepare?: () => Promise<Ready | Settled>;
  /** The change itself, with the consent given and what `prepare` read. */
  apply: (consent: Consent, ready: Ready) => Promise<CommandResult>;
};

/**
 * Marks a command that does something destructive, and gives it the only way
 * to: a {@link Consent}, which every destructive operation takes and only a
 * confirmation makes. A command that does not extend this has no way to get
 * one, so it cannot delete, revoke or roll back anything.
 *
 * ```ts
 * export default class VariableRm extends Destructive(EnvironmentCommand) {}
 * ```
 *
 * The command declares `--force`, which gives consent without asking, in its
 * own `flags` with wording that says what it skips; without one it cannot be
 * forced, only asked. A command whose `--force` means something else (`setup`
 * overwriting files) gives consent with it too.
 */
export function Destructive<TBase extends CommandClass<BaseCommand>>(Base: TBase) {
  abstract class DestructiveCommand extends Promptable(Base) {
    /**
     * The whole of a destructive command's work, in one order: a dry run
     * answers with `preview`; otherwise `prepare` reads what the change needs,
     * consent is asked for, a no ends the run as skipped (`<verb>-cancelled`),
     * and a yes runs `apply` with it.
     */
    protected async confirmed<Ready = undefined>({
      preview,
      prepare,
      apply,
      message,
      ...gate
    }: DestructiveChange<Ready>): Promise<CommandResult> {
      if (this.dryRun) {
        return preview();
      }
      const ready = prepare === undefined ? undefined : await prepare();
      if (ready instanceof Settled) {
        return ready.result;
      }
      const consent = await this.consent({
        ...gate,
        message: typeof message === "function" ? await message(ready as Ready) : message,
      });
      if (consent === undefined) {
        return {
          status: "skipped",
          reason: `${gate.verb}-cancelled`,
          summary: {
            title: CANCELLED,
            sections: [],
          },
        };
      }

      // Without a `prepare`, `Ready` is its default, `undefined`.
      return apply(consent, ready as Ready);
    }

    /**
     * Ask for consent outside {@link confirmed}, for a command whose dry run
     * or skip is its own (`auth-method`'s last-method guard, `doctor --fix`).
     * `undefined` is a no. It throws during a dry run, which must answer first.
     *
     * Without a `retry` of the gate's own, the refusal suggests this
     * invocation again with `--force`, rebuilt from the command line as oclif
     * parsed it rather than as typed: its arguments (or the gate's
     * `arguments` in their place) and every flag but the ones that only say
     * how to answer, with `--force` set, a URL's credentials left out and the
     * run's scope put back on ({@link BaseCommand.rerun}).
     */
    protected async consent(gate: Gate): Promise<Consent | undefined> {
      // Rebuilt only when the gate names no retry of its own.
      const retried =
        "retry" in gate
          ? gate
          : {
              ...gate,
              retry: await this.rerun<ConsentFlags>({
                with: { force: true },
                arguments: gate.arguments,
              }),
            };
      const session = {
        interactive: !this.nonInteractive,
        force: this.force,
        dryRun: this.dryRun,
      };

      return Consent.request(retried, {
        ...session,
        confirmer: this.ui.confirmer(session),
      });
    }
  }

  return DestructiveCommand;
}
