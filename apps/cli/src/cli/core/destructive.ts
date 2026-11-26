import { type Interfaces, Flags } from "@oclif/core";

import { Consent, type Gate } from "@/lib/consent";
import { CANCELLED } from "@/lib/errors";

import type { BaseCommand } from "./base";
import type { EFFECT } from "./effect";
import { type Refusal, refusalError } from "./refusal";
import type { CommandResult } from "./types";
import type { CommandClass } from "@/lib/oclif/command-class";

/** How a gate refuses when nobody can be asked and `--force` was not given. */
const CONFIRMATION_REQUIRED_REFUSAL = {
  code: "E_CONFIRMATION_REQUIRED",
  message: "{message}",
  hint: "Ask a person first: {question} Pass --force only once they agree.",
  details: { question: "{question}" },
  next: ["{retry}"],
} as const satisfies Refusal;

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
 * It sits on a {@link Previewable} command, so what it would destroy is said by
 * the command's `preview` before anyone is asked, and `--force`, which gives
 * consent without asking, is this mixin's flag: a command that is not
 * destructive never takes it. A command whose `--force` also means more than
 * consent says so in `forces`, which is what the flag's help reads
 * (`setup` overwriting files).
 *
 * @param Base - The command class to extend.
 * @param forces - What `--force` does for this command, where the default sentence is not all of it.
 * @returns The class, with a gate for what it destroys.
 */
export function Destructive<
  TBase extends CommandClass<BaseCommand & { readonly [EFFECT]: "changes" }> &
    Pick<typeof BaseCommand, "baseFlags" | "enableJsonFlag">,
>(Base: TBase, forces: string = "Skip the confirmation. Required when non-interactive.") {
  /** A command that asks consent before it destroys, which takes the one `--force` every such command carries. */
  abstract class DestructiveCommand extends Base {
    /**
     * The flags of the command, with `--force`, the one every destructive
     * command takes, which the retry a refused confirmation suggests sets.
     * oclif reads a command's statics up the chain of classes only while each
     * declares a static of its own, so this mixin declares the two it passes on.
     */
    static override baseFlags = {
      ...Base.baseFlags,
      force: Flags.boolean({ char: "f", description: forces }),
    };

    /** Whether the command takes `--json`, as the class it extends says. */
    static override enableJsonFlag = Base.enableJsonFlag;

    /**
     * The whole of a destructive command's `apply`, in one order: `prepare`
     * reads what the change needs, consent is asked for, a no ends the run as
     * skipped (`<verb>-cancelled`), and a yes runs `apply` with it. Without a
     * `prepare`, `Ready` is its default, `undefined`.
     */
    protected async confirmed<Ready = undefined>({
      prepare,
      apply,
      message,
      ...gate
    }: DestructiveChange<Ready>): Promise<CommandResult> {
      const ready = prepare === undefined ? undefined : await prepare();
      if (ready instanceof Settled) {
        return ready.result;
      }
      const consent = await this.consent({
        ...gate,
        message: typeof message === "function" ? await message(ready as Ready) : message,
      });
      if (consent === undefined) {
        return this.cancelled(gate.verb);
      }

      return apply(consent, ready as Ready);
    }

    /**
     * The result of a run whose person said no: skipped, as `<verb>-cancelled`,
     * never an error. Every command that asks for consent ends a no this way.
     *
     * @param verb - What was declined, as the gate named it.
     * @param lines - What the run left as it was, said under the headline.
     * @returns The skipped result.
     */
    protected cancelled(verb: string, lines: readonly string[] = []): CommandResult {
      return {
        status: "skipped",
        reason: `${verb}-cancelled`,
        summary: {
          title: CANCELLED,
          sections: [],
          ...(lines.length === 0 ? {} : { lines: [...lines] }),
        },
      };
    }

    /**
     * Ask for consent outside {@link confirmed}, for a command whose dry run
     * or skip is its own (`auth-method`'s last-method guard, `doctor --fix`).
     * `undefined` is a no. It throws during a dry run, which must answer first
     * (`preview`).
     *
     * Without a `retry` of the gate's own, the refusal suggests this
     * invocation again with `--force`, rebuilt from the command line as oclif
     * parsed it rather than as typed: its arguments (or the gate's
     * `arguments` in their place) and every flag but the ones that only say
     * how to answer, with `--force` set, a URL's credentials left out and the
     * run's scope put back on ({@link BaseCommand.rerun}).
     */
    protected async consent(gate: Gate): Promise<Consent | undefined> {
      const retried =
        "retry" in gate
          ? gate
          : {
              ...gate,
              retry: await this.rerun<{ force: Interfaces.BooleanFlag<boolean> }>({
                with: { force: true },
                arguments: gate.arguments,
              }),
            };
      const session = {
        interactive: !this.nonInteractive,
        force: this.force,
        dryRun: this.meta.dryRun,
      };

      return Consent.request(
        {
          ...retried,
          refuse:
            retried.refuse ??
            ((error) => {
              return refusalError(
                CONFIRMATION_REQUIRED_REFUSAL,
                {
                  ...error,
                  message: error.message,
                  question: gate.message,
                },
                {
                  retry: retried.retry === undefined ? [] : retried.retry,
                },
              );
            }),
        },
        {
          ...session,
          confirmer: this.ui.confirmer(session),
        },
      );
    }
  }

  return DestructiveCommand;
}
