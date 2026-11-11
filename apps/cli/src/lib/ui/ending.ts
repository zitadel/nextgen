import pc from "picocolors";

import { command, dim, strong } from "@/lib/style";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { Facts, Frame, stripColumnMarks } from "./layout";
import type { Presentation } from "./presentation";
import { NEXT_LABEL, type Summary } from "./summary";
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
   * wrong for an error — it would make `Error: Variable not found (E_NOT_FOUND)` read exactly
   * like `No variables found`. It is folded to the same width as
   * everything else, which a server message pasted into it needs most of all,
   * and it keeps the dim place footer: which project, on which server, is
   * what a run that failed against the wrong one is read for.
   */
  renderStandalone(): string {
    const rendered = this.body(false, false);
    const body = this.laidOutWithSteps(rendered);
    const place = this.where.known ? [this.where.plain] : [];
    if (this.summary.failed === true) {
      const stated = stripColumnMarks(this.summary.title)
        .split("\n")
        .map((line) => pc.red(line));
      // The next steps are set off by a blank line from what precedes them,
      // as they are under every other ending; the hint sits directly under
      // the error it explains.
      const hint = rendered.length === 0 ? "" : this.laidOut(rendered);
      const after = this.after();
      const under = [...(hint === "" ? [] : [hint]), ...(after === "" ? [] : ["", after])];
      const footer = place.length === 0 ? [] : ["", pc.dim(place.join(" · "))];
      return `${[...stated, ...under, ...footer].join("\n")}\n`;
    }
    const said = this.summary.title === "Done" ? [] : [this.summary.title];
    const footer = [...said, ...(this.summary.extras ?? []), ...place]
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .join(" · ");
    // With no answer of its own the next steps follow whatever the command
    // wrote above, so they open on the blank line that sets them off from it.
    const setOff = rendered.length === 0 && this.after() !== "" ? [""] : [];
    return [
      ...setOff,
      ...(body === "" ? [] : [body, ""]),
      ...(footer === "" ? [] : [pc.dim(footer)]),
      "",
    ].join("\n");
  }

  /**
   * The body as it is drawn, then the next steps and the overview under it, a
   * blank line apart. Nothing is folded: a command broken across lines can no
   * longer be run, and a terminal that wraps a long line keeps it one command
   * when it is copied.
   */
  private laidOutWithSteps(body: readonly string[]): string {
    return [body.length === 0 ? "" : this.laidOut(body), this.after()]
      .filter((part) => part !== "")
      .join("\n\n");
  }

  /** What follows the answer, set off from it by a blank line: the next steps, then the overview. */
  private after(): string {
    return [this.nextBlock(), this.overview()].filter((part) => part !== "").join("\n\n");
  }

  /**
   * The next steps of a normal command: the heading in bold, a sentence per
   * step, and each command on a `$` line the way a person copies it. The
   * heading is written once however many steps there are, and a step that
   * only repeats it is left out.
   */
  private nextBlock(): string {
    const steps = this.presentation === "plain" ? (this.summary.next ?? []) : [];
    if (steps.length === 0) {
      return "";
    }
    return [
      strong(NEXT_LABEL),
      ...steps.flatMap((step) => [
        ...(step.text === NEXT_LABEL
          ? []
          : stripColumnMarks(step.text)
              .split("\n")
              .map((line) => `  ${escapeControlCharacters(line)}`)),
        ...(step.command === undefined
          ? []
          : step.command.split("\n").map((one) => `  ${dim("$")} ${command(one)}`)),
      ]),
    ].join("\n");
  }

  /** Where to find every command, when the command asks to end on it. */
  private overview(): string {
    return this.presentation === "plain" ? (this.summary.overview ?? "") : "";
  }

  /** The body as it is drawn: as written, with the marks a builder left on its rows taken off. */
  private laidOut(body: readonly string[]): string {
    return stripColumnMarks(body.join("\n"));
  }

  /**
   * The line that closes the chain, red when the headline is a failure.
   *
   * Nothing is folded to a width here: the terminal wraps a long line to its
   * own, and a line it wraps is still one line when it is copied. Only the box
   * has a width of its own, because its border has to line up.
   */
  get line(): string {
    const title = stripColumnMarks(this.summary.title);
    return this.summary.failed === true ? pc.red(title) : title;
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
      return body.length === 0 ? undefined : `${indent(stripColumnMarks(body.join("\n")))}\n`;
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
  private body(withExtras = true, withSteps = true): string[] {
    const extras = this.summary.extras ?? [];
    return trimBlank([
      ...(this.summary.sections.length === 0
        ? []
        : [new Facts(this.summary.sections).render(), ""]),
      ...(this.summary.lines ?? []),
      ...(withSteps ? this.steps() : []),
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
