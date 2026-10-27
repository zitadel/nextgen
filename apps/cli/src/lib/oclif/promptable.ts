import { type Asker, input as askInput } from "../input";
import type { Questions } from "../ui";
import type { BaseCommand } from "./base";

/** A class that can be extended, abstract or not, whatever arguments it takes. */
// biome-ignore lint/suspicious/noExplicitAny: the constructor of any command, which a mixin cannot name
type CommandClass<T extends BaseCommand> = abstract new (...args: any[]) => T;

/**
 * Marks a command that can ask a person a question, and gives it the one way
 * to do it. Only a command built on this has `this.ask`, so what can prompt
 * is visible in the class it extends, and a command that does not extend it
 * cannot start prompting without that showing in review.
 *
 * ```ts
 * export default class Reset extends Promptable(BaseCommand) {}
 * export default class VariableSet extends Promptable(EnvironmentCommand) {}
 * ```
 *
 * There is one method per kind of question — `text`, `secret`, `select`,
 * `multiselect`, `confirm` — so a command states only the question and the
 * answer's type follows from it. See {@link Questions} for what each one
 * returns, and `lib/input.ts` for the order the answer is looked for in and
 * what is thrown when there is none.
 */
export function Promptable<TBase extends CommandClass<BaseCommand>>(Base: TBase) {
  abstract class PromptableCommand extends Base {
    /**
     * The questions this command may ask. Read through `this.ui` so each one
     * is drawn inside the command's own chain, with this invocation's
     * interactivity (`--non-interactive`, `--json`, no terminal) and `--force`
     * already filled in. A getter rather than a field: the audience is settled
     * when flags are parsed, which is after the command is constructed.
     */
    protected get ask(): Questions {
      return this.ui.questions();
    }

    /**
     * @deprecated {@link ask} replaced it. The last caller is
     * `commands/env/add.ts`; this goes with it.
     */
    protected readonly input: Asker = ((
      // biome-ignore lint/suspicious/noExplicitAny: an overloaded call cannot be forwarded without it
      question: any,
    ) =>
      askInput(question, {
        interactive: !this.meta.nonInteractive,
        force: this.meta.force,
        before: () => this.ui.open(),
        after: () => this.ui.answered(),
      })) as Asker;
  }
  return PromptableCommand;
}
