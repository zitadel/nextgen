import { log, warnings } from "@/lib/ui";

import type { CommandClass } from "./command-class";

/**
 * Gives a command the four ways to say something while it works: `info`,
 * `warn`, `fail` and `debug`.
 *
 * A command says what it is doing with `this.info(...)`, and the library code
 * under it says the same with the global `log`. Both reach the one place the
 * running command drew its output when it started: a terminal draws the line,
 * `--json` draws nothing, and a pipe is given only warnings and failures, so a
 * script reading stdout is given the command's result and nothing a command
 * merely said. What a script must read belongs in the result, never in a line
 * said here.
 *
 * ```ts
 * export abstract class BaseCommand extends Loggable(Documented(Interruptible(Command))) {}
 *
 * // in a command
 * this.info("Adding the production environment");
 * this.debug(`Wrote ${file}`);
 * ```
 *
 * The oclif command already has a `warn` and a `debug` of its own. They are
 * replaced here, so what oclif itself says and what a command says are drawn
 * the same way: `warn` reports a warning, which `--json` carries in the result,
 * and `debug` is shown only under `--debug`.
 *
 * Only `BaseCommand` is built on this. A class that is not a command, such as a
 * wizard step or a library, says the same through the global `log`.
 */
export function Loggable<TBase extends CommandClass>(Base: TBase) {
  abstract class LoggableCommand extends Base {
    /**
     * Says what the command is doing: a fact a person at a terminal follows, such
     * as the phase it has begun. Not shown to a pipe or under `--json`.
     *
     * @param args - What to say, formatted the way `console` formats it.
     */
    protected info(...args: unknown[]): void {
      log.info(...args);
    }

    /**
     * Reports something that worked but wants a look, as a warning, which
     * `--json` carries in the result and a pipe is still given.
     *
     * @param input - The warning, or the error it came from.
     * @returns The input, as the oclif command's own `warn` does.
     */
    override warn(input: Error | string): Error | string {
      warnings.report(input instanceof Error ? input.message : input);

      return input;
    }

    /**
     * Says that something failed, without ending the command.
     *
     * @param args - What to say, formatted the way `console` formats it.
     */
    protected fail(...args: unknown[]): void {
      log.fail(...args);
    }

    /**
     * Says detail nobody asked for, shown only under `--debug`.
     *
     * @param args - What to say, formatted the way `console` formats it.
     */
    protected override debug = (...args: unknown[]): void => {
      log.debug(...args);
    };
  }

  return LoggableCommand;
}
