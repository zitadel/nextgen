import { Consent, type Gate } from "../consent";
import { shellArg } from "../shell";
import { inShell } from "../suggestion";
import type { BaseCommand } from "./base";
import { Promptable } from "./promptable";
import type { CommandResult } from "./types";

/** A class that can be extended, abstract or not, whatever arguments it takes. */
// biome-ignore lint/suspicious/noExplicitAny: the constructor of any command, which a mixin cannot name
type CommandClass<T extends BaseCommand> = abstract new (...args: any[]) => T;

/** Flags that say how a run answers, not what it does, so a retry leaves them out. */
const ANSWERING = new Set(["--force", "-f", "--json", "--non-interactive", "-n"]);

/**
 * The `user:password@` of a URL, which a retry never prints: everything in the
 * authority up to its last `@`, since a password may hold one.
 */
const CREDENTIALS = /(\w+:\/\/)[^/?#\s]*@/g;

/** A result that ends a run before anyone is asked, from {@link DestructiveChange.prepare}. */
export class Settled {
  readonly result: CommandResult;

  constructor(result: CommandResult) {
    this.result = result;
  }
}

/** A destructive change: the question that guards it, and the change. */
export type DestructiveChange<Ready = undefined> = Gate & {
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
      ...gate
    }: DestructiveChange<Ready>): Promise<CommandResult> {
      if (this.meta.dryRun) {
        return preview();
      }
      const ready = prepare === undefined ? undefined : await prepare();
      if (ready instanceof Settled) {
        return ready.result;
      }
      const consent = await this.consent(gate);
      if (consent === undefined) {
        return { status: "skipped", reason: `${gate.verb}-cancelled` };
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
     * invocation again with `--force`, as typed: after the leading arguments,
     * without the flags that only say how to answer or a URL's credentials,
     * and with the selector put back on by {@link BaseCommand.retryCommand}.
     * Whatever follows a `--` stays last, after it, where it is read as
     * arguments rather than flags.
     */
    protected consent(gate: Gate): Promise<Consent | undefined> {
      const words = this.argv.map((word) => word.replace(CREDENTIALS, "$1"));
      const delimiter = words.indexOf("--");
      const typed = (delimiter === -1 ? words : words.slice(0, delimiter)).filter(
        (word) => !ANSWERING.has(word),
      );
      const leading = typed.findIndex((word) => word.startsWith("-"));
      const split = leading === -1 ? typed.length : leading;
      const command = this.retryCommand([
        ...(this.id ?? "").split(":").filter((word) => word !== ""),
        ...typed.slice(0, split),
        "--force",
        ...typed.slice(split),
      ]);
      const trailing = delimiter === -1 ? [] : words.slice(delimiter + 1);
      const retry =
        trailing.length === 0
          ? command
          : inShell(command, { after: ` -- ${trailing.map(shellArg).join(" ")}` });
      return Consent.request("retry" in gate ? gate : { ...gate, retry }, {
        interactive: !this.meta.nonInteractive,
        force: this.meta.force,
        dryRun: this.meta.dryRun,
      });
    }
  }
  return DestructiveCommand;
}
