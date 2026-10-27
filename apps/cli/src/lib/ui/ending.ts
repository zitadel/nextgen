import pc from "picocolors";

import { Facts, Frame, GUTTER, Prose, WIDTH } from "./layout";
import type { Presentation } from "./presentation";
import type { Summary } from "./summary";
import type { Where } from "./where";

/**
 * How a command's {@link Summary} becomes the last thing drawn: the one line
 * the chain closes on, and what is drawn under it.
 *
 * It is pure string work, like the rest of the layout, so the decision every
 * command's ending turns on — which of the two shapes it is — is asserted in
 * a unit test rather than inferred from a terminal recording.
 *
 * A wizard's box frames what the command produced, with where it ran as its
 * last line. A normal command has neither a chain to close nor a box to fill:
 * its answer starts at the left margin, with one dim footer line under it.
 */
export class Ending {
  private readonly summary: Summary;
  private readonly where: Where;
  private readonly presentation: Presentation;

  constructor(summary: Summary, where: Where, presentation: Presentation = "wizard") {
    this.summary = summary;
    this.where = where;
    this.presentation = presentation;
  }

  /**
   * Whether this ending stands on its own rather than closing a chain, which
   * follows the command's {@link Presentation} and nothing about the run. A
   * normal command's answer starts at the left margin, with one dim footer
   * line under it saying what the answer amounts to and where it came from —
   * whether or not it asked a question, warned, or was spared its question by
   * `--force`.
   */
  get standalone(): boolean {
    return this.presentation === "plain";
  }

  /**
   * The answer and its footer, for a command that drew no chain.
   *
   * The answer is wrapped like everything else, which leaves a table's rows
   * whole and folds a long sentence rather than running it off the screen;
   * the footer is one line by construction, so it is left as it is.
   *
   * A failure says so in red above what it has to say, rather than in the
   * footer: the footer is dim and unmarked, which is right for an answer and
   * wrong for an error — it would make `Error E_NOT_FOUND: …` read exactly
   * like `No variables found`. It is folded to the same width as
   * everything else, which a server message pasted into it needs most of all,
   * and it keeps the dim place footer: which project, on which server, is
   * what a run that failed against the wrong one is read for.
   */
  renderStandalone(): string {
    const body = this.body(false);
    const place = this.where.known ? [this.where.plain] : [];
    if (this.summary.failed === true) {
      const stated = new Prose(this.summary.title, WIDTH, false)
        .render()
        .split("\n")
        .map((line) => pc.red(line));
      const under = body.length === 0 ? [] : [new Prose(body.join("\n"), WIDTH).render()];
      const footer = place.length === 0 ? [] : ["", pc.dim(place.join(" · "))];
      return `${[...stated, ...under, ...footer].join("\n")}\n`;
    }
    const said = this.summary.title === "Done" ? [] : [this.summary.title];
    const footer = [...said, ...(this.summary.extras ?? []), ...place]
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .join(" · ");
    return [
      ...(body.length === 0 ? [] : [new Prose(body.join("\n"), WIDTH).render(), ""]),
      ...(footer === "" ? [] : [pc.dim(footer)]),
      "",
    ].join("\n");
  }

  /**
   * The line that closes the chain, red when the headline is a failure.
   *
   * A success's headline is a short label and is one line by construction. A
   * failure's is the whole sentence, and a URL or a server message can make it
   * longer than the terminal: it is folded to what the chain's gutter leaves,
   * and the folded lines are indented to sit under the first, so the sentence
   * is said once, in one place, and still fits.
   */
  get line(): string {
    return new Prose(this.summary.title, WIDTH - GUTTER, false)
      .render()
      .split("\n")
      .map((part, index) => (index === 0 ? part : " ".repeat(GUTTER) + part))
      .map((part) => (this.summary.failed === true ? pc.red(part) : part))
      .join("\n");
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
      ...this.steps(),
      ...(withExtras && extras.length > 0 ? ["", ...extras] : []),
    ]);
  }

  /**
   * What to do next, written out as lines, for a normal command: it has no box
   * to hold the steps, and dropping them would lose the command a person is
   * meant to run next — the one thing an ending is most often read for.
   */
  private steps(): string[] {
    const steps = this.presentation === "plain" ? (this.summary.next ?? []) : [];
    return steps.flatMap((step) => [
      step.text,
      ...(step.command === undefined ? [] : step.command.split("\n").map((one) => `  $ ${one}`)),
    ]);
  }

  /**
   * Whether to frame what the command ended on. Only a wizard is ever framed:
   * a normal command's table or record is what was asked for, and a border
   * around it helps nobody and breaks copying a wide one. A summary that asks
   * for a box it is not entitled to is refused here rather than anywhere
   * else, so one marker decides the whole shape.
   *
   * Steps bring their own frame. A wizard writes none of them out as lines,
   * so a summary carrying steps but no `boxed` would lose them in silence —
   * the overview and the skills offer the base command appends included.
   * `boxed` therefore means what it says it means: draw the box even with no
   * steps.
   */
  private boxed(): boolean {
    if (this.presentation !== "wizard") {
      return false;
    }
    return this.summary.boxed === true || (this.summary.next ?? []).length > 0;
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
