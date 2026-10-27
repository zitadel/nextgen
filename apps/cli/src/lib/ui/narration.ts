import { consola, type ConsolaReporter } from "consola";
import { format } from "node:util";
import pc from "picocolors";

import type { Chain } from "./chain";
import { GUIDE, MARK } from "./marks";

/**
 * A bridge for the narration the CLI still writes with `consola`.
 *
 * Most of the CLI says what it is doing with `consola.info` and friends.
 * Rewriting every one of those into a task at once would be a large, risky
 * change, so while a chain is open those lines are drawn inside it with its
 * gutter and the mark their level deserves. A command that has been moved to
 * tasks and steps needs none of this; one that has not still looks like the
 * others.
 *
 * `consola` is a process-wide singleton, so the bridge is installed for one
 * command and {@link Narration.restore}d when it ends. Without that, a second
 * command in the same process — every command in the unit tests — would keep
 * drawing into a chain that has closed.
 */
const MARKS: Readonly<Record<string, string>> = {
  success: MARK.done,
  ready: MARK.done,
  info: pc.cyan("ℹ"),
  start: pc.cyan("◐"),
  warn: MARK.warning,
  error: MARK.failed,
  fail: MARK.failed,
  fatal: MARK.failed,
  debug: pc.dim("·"),
  trace: pc.dim("·"),
};

export class Narration {
  private readonly chain: Chain;
  private previous: ConsolaReporter[] | undefined;

  constructor(chain: Chain) {
    this.chain = chain;
  }

  /** Draws consola's output into the chain until {@link restore}. */
  install(): void {
    if (this.previous !== undefined) {
      return;
    }
    this.previous = [...consola.options.reporters];
    consola.setReporters([{ log: (entry) => this.draw(format(...entry.args), entry.type) }]);
  }

  /** Gives consola its own reporters back, whatever happened to the command. */
  restore(): void {
    if (this.previous === undefined) {
      return;
    }
    consola.setReporters(this.previous);
    this.previous = undefined;
  }

  private draw(text: string, type: string): void {
    if (text.trim() === "") {
      return;
    }
    this.chain.narrate(MARKS[type] ?? GUIDE, text.replace(/^\n+/, ""));
  }
}
