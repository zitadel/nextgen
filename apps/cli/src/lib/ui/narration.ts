import { consola, type ConsolaReporter } from "consola";
import { format } from "node:util";

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

/** What the bridge needs of the chain it draws into, and nothing more. */
export interface Narratable {
  /** One line in the chain: its mark, then the text. */
  narrate(symbol: string, text: string): void;
}

/** The mark a consola level deserves. An unlisted level is a plain gutter line. */
const MARKS: Readonly<Record<string, string>> = {
  success: MARK.done,
  ready: MARK.done,
  info: MARK.info,
  start: MARK.started,
  warn: MARK.warning,
  error: MARK.failed,
  fail: MARK.failed,
  fatal: MARK.failed,
  debug: MARK.detail,
  trace: MARK.detail,
};

export class Narration {
  private readonly chain: Narratable;
  private previous: ConsolaReporter[] | undefined;

  constructor(chain: Narratable) {
    this.chain = chain;
  }

  /** Whether consola is currently drawing into the chain. */
  get installed(): boolean {
    return this.previous !== undefined;
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
