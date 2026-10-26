import { type Asker, input as askInput } from "../input";
import type { BaseCommand } from "./base";

/** A class that can be extended, abstract or not, whatever arguments it takes. */
// biome-ignore lint/suspicious/noExplicitAny: the constructor of any command, which a mixin cannot name
type CommandClass<T extends BaseCommand> = abstract new (...args: any[]) => T;

/**
 * Marks a command that can ask a person a question, and gives it the one way
 * to do it. Only a command built on this has `this.input`, so what can prompt
 * is visible in the class it extends, and a command that does not extend it
 * cannot start prompting without that showing in review.
 *
 * ```ts
 * export default class Reset extends Promptable(BaseCommand) {}
 * export default class VariableSet extends Promptable(EnvironmentCommand) {}
 * ```
 *
 * `input` is {@link askInput} with this invocation's interactivity
 * (`--non-interactive`, `--json`, no terminal) and `--force` filled in, so a
 * command states only the question. See {@link askInput} for the order the
 * answer is looked for in and what is thrown when there is none.
 */
export function Promptable<TBase extends CommandClass<BaseCommand>>(Base: TBase) {
  abstract class PromptableCommand extends Base {
    protected readonly input: Asker = (question) =>
      askInput(question, { interactive: !this.meta.nonInteractive, force: this.meta.force });

    /**
     * For a command whose `--force` means something other than "yes to every
     * confirm" (`setup` overwrites files with it): the same asker, which never
     * answers a confirm on its own.
     */
    protected readonly inputUnforced: Asker = (question) =>
      askInput(question, { interactive: !this.meta.nonInteractive, force: false });
  }
  return PromptableCommand;
}
