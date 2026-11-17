import { escapeControlCharacters } from "@/lib/terminal-text";

import { log } from "./log";

/**
 * The warnings of this invocation. This is the only way the CLI warns: never
 * call `log.warn` directly (see `apps/cli/AGENTS.md`).
 *
 * The CLI runs one command per process, so one instance ({@link warnings}) is
 * the invocation's list; `BaseCommand` clears it when a command starts and
 * drains it into the envelope when the command emits.
 */
export class Warnings {
  /** Warnings reported during this invocation, as they came. */
  private readonly reported: string[] = [];

  /**
   * Report a warning.
   *
   * A terminal shows the warning at once, which matters when it comes before a
   * long wait. `--json` silences that output, so the warning is also kept for
   * the envelope's `warnings`, and both kinds of reader see it.
   *
   * A warning names what the server answered, so what reaches the terminal is
   * spelled out here: this is the one path to a terminal that does not go
   * through `BaseCommand.emit`. What is kept for the envelope is the message as
   * it came, because a reader parses the real text out of the envelope — the
   * same split `BaseCommand` makes for a failure's message and hint.
   *
   * @param message - What to warn about.
   */
  report(message: string): void {
    log.warn(escapeControlCharacters(message));
    this.reported.push(message);
  }

  /**
   * Take every warning reported so far, leaving none behind.
   *
   * @returns The warnings, oldest first, as they were reported.
   */
  take(): string[] {
    return this.reported.splice(0);
  }
}

/** The process-wide warnings every command and library reports to. */
export const warnings = new Warnings();
