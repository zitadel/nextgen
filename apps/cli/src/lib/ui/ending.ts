import pc from "picocolors";

import { Facts, Frame } from "./layout";
import type { Summary } from "./summary";
import type { Where } from "./where";

/**
 * How a command's {@link Summary} becomes the last thing drawn: the one line
 * the chain closes on, and what is drawn under it.
 *
 * It is pure string work, like the rest of the layout, so the decision every
 * command's ending turns on — whether there is enough to deserve a box — is
 * asserted in a unit test rather than inferred from a terminal recording.
 *
 * A box frames what the command produced, with where it ran as its last line.
 * Where it ran is a footnote to the report and never a reason for a frame of
 * its own: a command that produced nothing says it in the chain's own gutter.
 */
export class Ending {
  private readonly summary: Summary;
  private readonly where: Where;

  constructor(summary: Summary, where: Where) {
    this.summary = summary;
    this.where = where;
  }

  /** The one line that closes the chain, red when the headline is a failure. */
  get line(): string {
    return this.summary.failed === true ? pc.red(this.summary.title) : this.summary.title;
  }

  /**
   * Everything under the closing line, ready to write, or `undefined` when
   * there is nothing to say: the newlines are part of it, so the caller only
   * writes what it is given.
   */
  render(): string | undefined {
    const body = this.body();
    if (!this.boxed()) {
      // A listing is what the command was asked for, printed as it is. Where it
      // ran is part of a summary, so a command that has no summary does not
      // say it: the table is the answer, and nothing else belongs under it.
      return body.length === 0 ? undefined : `${indent(body.join("\n"))}\n`;
    }
    // The report and the steps share one frame: what the command produced and
    // what to do about it belong together.
    return `\n${new Frame(
      this.summary.boxTitle ?? "Summary",
      body,
      this.summary.next ?? [],
      this.where.known ? this.where.render() : undefined,
    ).render()}\n`;
  }

  /** The facts the command stated, then whatever it rendered itself. */
  private body(): string[] {
    return trimBlank([
      ...(this.summary.sections.length === 0
        ? []
        : [new Facts(this.summary.sections).render(), ""]),
      ...(this.summary.lines ?? []),
    ]);
  }

  /**
   * Whether to frame what the command ended on. Only something to do next
   * earns a frame: a table or a record is what was asked for, and a border
   * around it helps nobody and breaks copying a wide one.
   */
  private boxed(): boolean {
    return this.summary.boxed === true;
  }
}

/** Everything under the closing line clears the chain's gutter by this much. */
const indent = (text: string): string => text.replace(/^(?=.)/gm, "   ");

/** Drops the blank lines a command's own rendering leaves at either end. */
function trimBlank(lines: readonly string[]): string[] {
  const out = [...lines];
  while (out[0]?.trim() === "") {
    out.shift();
  }
  while (out.at(-1)?.trim() === "") {
    out.pop();
  }
  return out;
}
