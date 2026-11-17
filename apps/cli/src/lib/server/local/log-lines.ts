import { type LogLine, logText, renderLogLine } from "./server-log";

/**
 * Lines of the local server's log, as the commands show them: kept in the order
 * the server wrote them and never changed. The runtime hands these back, so a
 * command asks the lines how to draw themselves and never calls a helper.
 */
export class LogLines {
  private readonly items: readonly LogLine[];

  /**
   * @param items - The lines, in the order the server wrote them.
   */
  constructor(items: readonly LogLine[]) {
    this.items = items;
  }

  /** Whether there are no lines. */
  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /**
   * @returns The lines as one text, as `--json` reports them.
   */
  text(): string {
    return logText(this.items);
  }

  /**
   * @param color - Whether to colour warnings and errors.
   * @returns Each line as it is drawn on a terminal.
   */
  drawn(color: boolean): string[] {
    return this.items.map((line) => {
      return renderLogLine(line, color);
    });
  }
}
