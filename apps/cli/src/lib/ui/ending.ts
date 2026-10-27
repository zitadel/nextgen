import pc from "picocolors";

import { Facts, Frame, Prose, WIDTH } from "./layout";
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
  private readonly inChain: boolean;

  constructor(summary: Summary, where: Where, inChain = true) {
    this.summary = summary;
    this.where = where;
    this.inChain = inChain;
  }

  /**
   * A command that only answers something, and asked nothing on the way, draws
   * no chain at all: its answer starts at the left margin, with one dim footer
   * line under it saying what the answer amounts to and where it came from.
   *
   * Never a failure. The footer is dim and unmarked, which is right for an
   * answer and wrong for an error: it would make `Error E_NOT_FOUND: …` read
   * exactly like `No variables on the project`. A failure always closes a
   * chain, so it ends on a red line with a mark against it.
   */
  get standalone(): boolean {
    return !this.inChain && !this.boxed() && this.summary.failed !== true;
  }

  /** The answer and its footer, for a command that drew no chain. */
  renderStandalone(): string {
    const said = this.summary.title === "Done" ? [] : [this.summary.title];
    const place = this.where.known ? [this.where.plain] : [];
    const footer = [...said, ...(this.summary.extras ?? []), ...place]
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .join(" · ");
    const body = this.body(false);
    return [
      ...(body.length === 0 ? [] : [body.join("\n"), ""]),
      ...(footer === "" ? [] : [pc.dim(footer)]),
      "",
    ].join("\n");
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
      // Wrapped like everything else, which leaves a table's rows alone and
      // folds a long error message instead of running it off the screen.
      return body.length === 0
        ? undefined
        : `${indent(new Prose(body.join("\n"), WIDTH - INDENT).render())}\n`;
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

  /**
   * The facts the command stated, then whatever it rendered itself, then what
   * it added after that.
   *
   * The extras are the footer of a standalone ending, so that path asks for
   * them separately (`withExtras: false`) and places them itself. Everywhere
   * else they belong under the body: a command that opened a chain — because
   * something warned, or because a step span a spinner — must not lose a line
   * the same command prints without one.
   */
  private body(withExtras = true): string[] {
    const extras = this.summary.extras ?? [];
    return trimBlank([
      ...(this.summary.sections.length === 0
        ? []
        : [new Facts(this.summary.sections).render(), ""]),
      ...(this.summary.lines ?? []),
      ...(withExtras && extras.length > 0 ? ["", ...extras] : []),
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
const INDENT = 3;
const indent = (text: string): string => text.replace(/^(?=.)/gm, " ".repeat(INDENT));

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
