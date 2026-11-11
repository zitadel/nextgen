import { type EnvironmentSelector, projectCommand, type SuggestedCommand } from "@/lib/suggestion";
import type { BaseCommand } from "./base";

/** A class that can be extended, abstract or not, whatever arguments it takes. */
// biome-ignore lint/suspicious/noExplicitAny: the constructor of any command, which a mixin cannot name
type CommandClass<T extends BaseCommand> = abstract new (...args: any[]) => T;

/**
 * Gives a command the one way to suggest a command to run next. A suggestion
 * carries what the target needs to act on the same project this run did: the
 * environment selector when the target takes one (`deploy`, `origin add`), and
 * only the directory when it does not (`setup`, `start`).
 *
 * ```ts
 * export default class Start extends Suggestible(BaseCommand) {}
 * export default class Stop extends Suggestible(Promptable(BaseCommand)) {}
 * ```
 *
 * The target decides, not the call site: the scope follows the flags the
 * target declares, so no suggestion has to remember whether it needs a
 * selector.
 */
export function Suggestible<TBase extends CommandClass<BaseCommand>>(Base: TBase) {
  abstract class SuggestibleCommand extends Base {
    /**
     * The flags that reproduce this run's choice of project: the directory
     * alone here, and the environment selection as well in a command that
     * resolves one.
     */
    protected selector(): EnvironmentSelector {
      return this.cwdSelector();
    }

    /**
     * A `zitadel` command to run next, in the public `npx` form.
     *
     * @param args - The command and its arguments, without the selector.
     * @returns The command with the selector its target takes put back on.
     */
    protected suggest(args: string): SuggestedCommand {
      const words = args.split(" ").filter((word) => {
        return !word.startsWith("-");
      });
      for (let length = Math.min(words.length, 3); length > 0; length -= 1) {
        const target = this.config.findCommand?.(words.slice(0, length).join(":"));
        if (target !== undefined) {
          const takesSelector = "env-file" in target.flags;
          return projectCommand(
            args,
            takesSelector ? this.selector() : this.cwdSelector(),
            this.meta.cliVersion,
          );
        }
      }
      return projectCommand(args, this.selector(), this.meta.cliVersion);
    }
  }
  return SuggestibleCommand;
}
