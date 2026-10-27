import { box, stripAnsi } from "consola/utils";
import pc from "picocolors";
import wrapAnsi from "wrap-ansi";

import type { BoxAction } from "../box";
import type { Section } from "./summary";

/**
 * How the CLI's output is laid out. Each piece of layout is a class that knows
 * how to render itself and nothing else: no terminal, no state, no side
 * effects, so what the output looks like can be asserted in a unit test.
 */

/** The widest anything the CLI draws may be, however wide the terminal is. */
export const WIDTH = 80;

/** What the chain's own gutter (`│  `) costs a line drawn inside it. */
export const GUTTER = 3;

/**
 * How wide a line looks on screen. Colour is invisible but not weightless:
 * a styled line is a dozen characters longer than it reads, so every width
 * decision here measures what the terminal shows, never `String.length`.
 */
const visible = (line: string): number => stripAnsi(line).length;

/** Anything that can turn itself into the text that is printed. */
export interface Renderable {
  render(): string;
}

/**
 * The gap a column layout puts between its cells. Everything that lays text
 * out in columns — {@link Facts}, the resource tables, a step's detail line —
 * separates them by at least this much, and {@link columnRows} looks for it.
 */
export const COLUMN_GAP = 2;

/**
 * Where each column after the first begins, inside the line.
 *
 * Measured at the end of the gap rather than its start: a cell is padded to
 * the width of its column, so it is the column after it that lines up, not the
 * space it was padded with.
 */
const gaps = (line: string): number[] =>
  [...stripAnsi(line).matchAll(new RegExp(`\\S( {${COLUMN_GAP},})(?=\\S)`, "g"))].map(
    (match) => match.index + 1 + (match[1]?.length ?? 0),
  );

/**
 * Which of these lines are rows of a column layout, and so must be left whole.
 *
 * A column is not "a line with two spaces in it": it is a gap that lines up
 * with the gap on the row above or below. Deciding it by the double space
 * alone exempted any sentence that happened to hold one — a label and three
 * `key=value` pairs joined by two spaces, or a stray double space after a full
 * stop — and let it run off the screen as a table nothing had aligned. So the
 * signal is the alignment itself, which only something that built columns
 * produces, and which a single sentence cannot fake.
 */
const columnRows = (lines: readonly string[]): boolean[] => {
  const starts = lines.map((line) => gaps(line));
  const shares = (a: number[], b: number[] | undefined): boolean =>
    b !== undefined && a.some((start) => b.includes(start));
  return starts.map(
    (own, index) =>
      own.length > 0 && (shares(own, starts[index - 1]) || shares(own, starts[index + 1])),
  );
};

/**
 * Prose, wrapped to a width. A wrapped line keeps the indent of its first line,
 * plus two more for a list item (`[ok] …`, `$ …`, `- …`), so what belongs to one
 * item stays visibly under it.
 *
 * A row of a column layout is left whole, since breaking it would break the
 * columns. `columns` says whether it holds any, and the caller answers because
 * it is the one that knows:
 *
 * - `true` — these lines are columns, so none of them is folded. A step's
 *   detail lines are built one at a time and say so, since one row on its own
 *   has nothing to line up with.
 * - `false` — no columns here, so everything folds. A frame is sized by its
 *   content, so a row wider than the frame would widen the frame; saying so
 *   is what keeps every box exactly {@link WIDTH} columns however wide the
 *   table it is handed.
 * - `"detect"` (the default) — a mix, such as what a command rendered for
 *   itself: each line is a row if it lines up with its neighbour.
 */
export class Prose implements Renderable {
  private readonly text: string;
  private readonly width: number;
  private readonly columns: boolean | "detect";

  constructor(text: string, width: number, columns: boolean | "detect" = "detect") {
    this.text = text;
    this.width = width;
    this.columns = columns;
  }

  render(): string {
    if (this.columns === true) {
      return this.text;
    }
    const lines = this.text.split("\n");
    const rows = this.columns === false ? [] : columnRows(lines);
    return lines.map((line, index) => (rows[index] === true ? line : this.wrap(line))).join("\n");
  }

  private wrap(line: string): string {
    if (visible(line) <= this.width) {
      return line;
    }
    const lead = /^\s*/.exec(line)?.[0] ?? "";
    const item = /^(\[\w+\]|\$|-|\d+\.) /.test(line.trimStart()) ? "  " : "";
    // A line indented further than the width would otherwise ask for a
    // negative one, which wraps every word onto its own line.
    return wrapAnsi(line.trimStart(), Math.max(1, this.width - lead.length - item.length))
      .split("\n")
      .map((part, index) => (index === 0 ? lead : lead + item) + part)
      .join("\n");
  }
}

/** The facts a command states, as aligned `label   value` rows under a heading. */
export class Facts implements Renderable {
  private readonly sections: readonly Section[];

  constructor(sections: readonly Section[]) {
    this.sections = sections;
  }

  render(): string {
    return this.sections.map((section) => this.one(section)).join("\n\n");
  }

  private one(section: Section): string {
    const width = Math.max(0, ...section.facts.map(([label]) => label.length));
    // One gap, wider than a column gap, in every row: the rows line up, which
    // is what tells the layout they are columns rather than sentences.
    const gap = " ".repeat(COLUMN_GAP + 1);
    return [
      ...(section.heading === undefined ? [] : [pc.bold(section.heading)]),
      ...section.facts.map(([label, value]) => `${pc.dim(label.padEnd(width))}${gap}${value}`),
    ].join("\n");
  }
}

/**
 * The one box the CLI draws: a {@link WIDTH}-wide frame holding what the command
 * produced and, under it, what to do next. Every command's box is the same
 * width and lays its steps out the same way, so two commands are comparable at
 * a glance.
 *
 * A step's sentence is wrapped to fit; its commands are not, because a command
 * broken across lines cannot be copied, so one longer than the frame widens it.
 * That is the only thing allowed to: everything else a box holds is wrapped,
 * a table it happens to be handed included, so no report can make the frame
 * wider than {@link WIDTH}.
 */
export class Frame implements Renderable {
  private static readonly INNER = WIDTH - 7;

  private readonly title: string;
  private readonly body: readonly string[];
  private readonly steps: readonly BoxAction[];
  private readonly footer: string | undefined;

  constructor(
    title: string,
    body: readonly string[],
    steps: readonly BoxAction[],
    footer?: string,
  ) {
    this.title = title;
    this.body = body;
    this.steps = steps;
    this.footer = footer;
  }

  render(): string {
    const blocks = [
      ...(this.body.length === 0
        ? []
        : [new Prose(this.body.join("\n"), Frame.INNER, false).render()]),
      ...this.steps.map((step) => this.step(step)),
      ...(this.footer === undefined ? [] : [new Prose(this.footer, Frame.INNER, false).render()]),
    ];
    // Not `consola.box`: while a chain is open, consola's own output is drawn
    // inside it. The last line is padded so every box is the same width, which
    // consola otherwise sizes to its content. consola measures a line without
    // its colour, so the padding must too: a styled last line — a command, or
    // the dimmed footer — would otherwise count its escapes as width and leave
    // the box as narrow as whatever it happens to hold.
    const lines = blocks.join("\n\n").split("\n");
    const last = lines.length - 1;
    const tail = lines[last] ?? "";
    lines[last] = tail + " ".repeat(Math.max(0, Frame.INNER - visible(tail)));
    return box(lines.join("\n"), {
      title: this.title,
      style: { padding: 1, borderStyle: "rounded", borderColor: "green", marginTop: 0 },
    });
  }

  private step(step: BoxAction): string {
    return [
      new Prose(step.text, Frame.INNER, false).render(),
      ...(step.command === undefined
        ? []
        : step.command.split("\n").map((command) => `  ${pc.bold(pc.cyan(command))}`)),
    ].join("\n");
  }
}
