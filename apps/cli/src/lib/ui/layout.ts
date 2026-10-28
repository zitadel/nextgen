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
 * The mark a column builder puts on a row it aligned itself.
 *
 * Alignment is evidence only where there is something to align with. A record
 * of one field is one line, so the columns `renderDetail` built have nothing
 * above or below them to agree with and {@link columnRows} cannot see them —
 * and widening that heuristic to cover a lone line is the bug it was written
 * to kill, since a one-row table and a sentence with a stray double space are
 * the same string. So the builder says so instead: a word joiner, which is
 * zero width, is not whitespace, and does not occur in a value.
 *
 * It leads the row rather than sitting in the gap, so the cells and the
 * spaces between them are exactly what they were and a reader, a `grep` and a
 * test all still see `status  active`. {@link Prose} takes it off everything
 * it renders, so it reaches the layout and never the eye.
 */
export const COLUMN_MARK = "\u2060";

/** This row, marked as one a column builder aligned itself. */
export const columnRow = (row: string): string => `${COLUMN_MARK}${row}`;

/** Whatever this text says without its marks, for anything but the layout. */
export const stripColumnMarks = (text: string): string => text.replaceAll(COLUMN_MARK, "");

/**
 * A line as the terminal shows it. Colour is invisible but not weightless: a
 * styled line is a dozen characters longer than it reads, and a marked row is
 * one character longer, so every width decision here measures what the
 * terminal shows, never `String.length`.
 */
const bare = (line: string): string => stripColumnMarks(stripAnsi(line));

/** How wide a line looks on screen. */
const visible = (line: string): number => bare(line).length;

/**
 * Where each column after the first begins, inside the line.
 *
 * Measured at the end of the gap rather than its start: a cell is padded to
 * the width of its column, so it is the column after it that lines up, not the
 * space it was padded with.
 */
const gaps = (line: string): number[] =>
  [...bare(line).matchAll(new RegExp(`\\S( {${COLUMN_GAP},})(?=\\S)`, "g"))].map(
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
 *   itself: a line is a row if its builder marked the gap it aligned
 *   ({@link COLUMN_MARK}), or, for text nothing here built, if it lines up
 *   with its neighbour.
 *
 * Whichever answer it is given, the marks are removed from what it renders:
 * they are how a builder reaches this decision, and nothing after it.
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
    const marked = this.text.split("\n").map((line) => line.includes(COLUMN_MARK));
    const lines = this.text.split("\n").map(stripColumnMarks);
    if (this.columns === true) {
      return lines.join("\n");
    }
    const aligned = this.columns === false ? [] : columnRows(lines);
    const row = (index: number): boolean =>
      this.columns !== false && (marked[index] === true || aligned[index] === true);
    return lines.map((line, index) => (row(index) ? line : this.wrap(line))).join("\n");
  }

  private wrap(line: string): string {
    if (visible(line) <= this.width) {
      return line;
    }
    const lead = /^\s*/.exec(line)?.[0] ?? "";
    const item = /^(\[\w+\]|\$|-|\d+\.) /.test(line.trimStart()) ? "  " : "";
    // A line indented further than the width it is folded to asks for a
    // negative one. `wrap-ansi` happens to read that as one column today,
    // which is not something it promises, so it is clamped here instead.
    // Either way such a line folds a word to a line; there is nothing better
    // to do with an indent wider than the terminal.
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
    // One gap, wider than a column gap, in every row. Each row is marked as
    // well: a section of one fact is one line, so the alignment it is laid
    // out with has nothing to agree with and only the mark says it is a row.
    const gap = " ".repeat(COLUMN_GAP + 1);
    return [
      ...(section.heading === undefined ? [] : [pc.bold(section.heading)]),
      ...section.facts.map(([label, value]) =>
        columnRow(`${pc.dim(label.padEnd(width))}${gap}${value}`),
      ),
    ].join("\n");
  }
}

/**
 * Where a command may be broken across lines: at a space between two of its
 * arguments. A space inside quotes is not one of them, because `\` before a
 * newline is literal inside single quotes, so breaking there would change the
 * argument rather than continue the command.
 *
 * A quote only opens one where something closes it. An apostrophe reaches here
 * on its own — a sentence that names a command carries the words after it into
 * the command (`nextSteps`), and `the app's config` is one quote — and reading
 * it as an opening quote left the whole rest of the line unbreakable and widened
 * the box for it.
 */
const argumentBreaks = (command: string): number[] => {
  const at: number[] = [];
  let quote: string | undefined;
  for (const [index, character] of [...command].entries()) {
    if (quote !== undefined) {
      quote = character === quote ? undefined : quote;
    } else if ((character === "'" || character === '"') && command.includes(character, index + 1)) {
      quote = character;
    } else if (character === " ") {
      at.push(index);
    }
  }
  return at;
};

/**
 * One command as the lines a frame can hold, written the way a shell writes a
 * command over several lines: every line but the last ends in `\`, which the
 * shell removes together with the newline, so what is copied out of the box is
 * still the one command it was and still runs.
 *
 * A break at a space between two arguments keeps `lead`, since the spaces that
 * rejoins only separate arguments that were already separate. An argument too
 * long to fit on a line of its own is broken where it must be and continued at
 * the margin, since `\`-newline is all the shell removes and an indent would
 * land inside the argument.
 */
export const wrapCommand = (command: string, width: number, lead = ""): string[] => {
  const lines: string[] = [];
  let rest = command;
  let indent = lead;
  while (indent.length + rest.length > width) {
    const room = Math.max(1, width - indent.length - 2);
    const cut = argumentBreaks(rest)
      .filter((at) => at > 0 && at <= room)
      .at(-1);
    if (cut === undefined) {
      // Nothing to break at, so this is one long token: a URL, a digest, a
      // path. It is left whole and the box widens for it. A `\` inside a
      // token does not survive being copied — a split URL stops being
      // clickable, and `claim` prints one the journey reads back out.
      break;
    }
    lines.push(`${indent}${rest.slice(0, cut)} \\`);
    rest = rest.slice(cut + 1);
    indent = lead;
  }
  return [...lines, indent + rest];
};

/**
 * The one box the CLI draws: a {@link WIDTH}-wide frame holding what the command
 * produced and, under it, what to do next. Every command's box is the same
 * width and lays its steps out the same way, so two commands are comparable at
 * a glance.
 *
 * Nothing in it is allowed to widen it past {@link WIDTH}: a step's sentence is
 * folded, so is the report and any table the box happens to be handed. A
 * command is never folded as prose, because a command broken across lines
 * cannot be run — it is written over several lines the way a shell writes one,
 * with {@link wrapCommand}, so it fits and still pastes back as itself.
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
        : step.command
            .split("\n")
            .flatMap((command) => wrapCommand(command, Frame.INNER, "  "))
            .map((line) => pc.bold(pc.cyan(line)))),
    ].join("\n");
  }
}
