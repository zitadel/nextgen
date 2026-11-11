import { stripVTControlCharacters as stripAnsi } from "node:util";
import pc from "picocolors";
import wrapAnsi from "wrap-ansi";

import type { BoxAction } from "@/lib/box";

import type { Section } from "./summary";

/**
 * How the CLI's output is laid out. Each piece of layout is a class that knows
 * how to render itself and nothing else: no terminal, no state, no side
 * effects, so what the output looks like can be asserted in a unit test.
 */

/** The widest anything the CLI draws may be, however wide the terminal is. */
export const WIDTH = 80;

/** Anything that can turn itself into the text that is printed. */
export interface Renderable {
  render(): string;
}

/**
 * The gap a column layout puts between its cells. Everything that lays text
 * out in columns — {@link Facts}, the resource tables, a step's detail line —
 * separates them by at least this much, and {@link columnRows} looks for it.
 */
const COLUMN_GAP = 2;

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
export const columnRow = (row: string): string => {
  return `${COLUMN_MARK}${row}`;
};

/** Whatever this text says without its marks, for anything but the layout. */
export const stripColumnMarks = (text: string): string => {
  return text.replaceAll(COLUMN_MARK, "");
};

/**
 * A line as the terminal shows it. Colour is invisible but not weightless: a
 * styled line is a dozen characters longer than it reads, and a marked row is
 * one character longer, so every width decision here measures what the
 * terminal shows, never `String.length`.
 */
const bare = (line: string): string => {
  return stripColumnMarks(stripAnsi(line));
};

/**
 * The columns a character takes: none for a combining mark or a zero-width
 * joiner, two for the East Asian wide and fullwidth forms and for emoji, one
 * for everything else. Counting code units instead would measure a name in
 * Chinese as half its width, so a line that overflows would be left unfolded
 * and a box's border would land in the wrong place.
 */
const columnsOf = (character: string): number => {
  const code = character.codePointAt(0) ?? 0;
  if (/^(?:\p{M}|[\u200B-\u200D\u2060])$/u.test(character)) {
    return 0;
  }
  const wide =
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd);
  return wide ? 2 : 1;
};

/** How wide a line looks on screen. */
const visible = (line: string): number => {
  return [...bare(line)].reduce((width, character) => {
    return width + columnsOf(character);
  }, 0);
};

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
  const starts = lines.map((line) => {
    return [...bare(line).matchAll(new RegExp(`\\S( {${COLUMN_GAP},})(?=\\S)`, "g"))].map(
      (match) => {
        return match.index + 1 + (match[1]?.length ?? 0);
      },
    );
  });
  const isRule = (line: string): boolean => {
    return /^[\u2500\u2501-]{3,}$/.test(bare(line).trim());
  };
  const neighbour = (index: number, step: 1 | -1): number[] | undefined => {
    let at = index + step;
    while (lines[at] !== undefined && isRule(lines[at] ?? "")) {
      at += step;
    }
    return starts[at];
  };
  const shares = (a: number[], b: number[] | undefined): boolean => {
    return (
      b !== undefined &&
      a.some((start) => {
        return b.includes(start);
      })
    );
  };
  return starts.map((own, index) => {
    return (
      own.length > 0 && (shares(own, neighbour(index, -1)) || shares(own, neighbour(index, 1)))
    );
  });
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
    const marked = this.text.split("\n").map((line) => {
      return line.includes(COLUMN_MARK);
    });
    const lines = this.text.split("\n").map(stripColumnMarks);
    if (this.columns === true) {
      return lines.join("\n");
    }
    const aligned = this.columns === false ? [] : columnRows(lines);
    const row = (index: number): boolean => {
      return this.columns !== false && (marked[index] === true || aligned[index] === true);
    };
    return lines
      .map((line, index) => {
        return row(index) ? line : this.wrap(line);
      })
      .join("\n");
  }

  private wrap(line: string): string {
    if (visible(line) <= this.width) {
      return line;
    }
    const lead = /^\s*/.exec(line)?.[0] ?? "";
    const item = /^(\[\w+\]|\$|-|\d+\.) /.test(line.trimStart()) ? "  " : "";
    return wrapAnsi(line.trimStart(), Math.max(1, this.width - lead.length - item.length), {
      hard: true,
    })
      .split("\n")
      .map((part, index) => {
        return `${index === 0 ? lead : `${lead}${item}`}${part}`;
      })
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
    return this.sections
      .map((section) => {
        return this.one(section);
      })
      .join("\n\n");
  }

  private one(section: Section): string {
    const width = Math.max(
      0,
      ...section.facts.map(([label]) => {
        return label.length;
      }),
    );
    return [
      ...(section.heading === undefined ? [] : [pc.bold(section.heading)]),
      ...section.facts.map(([label, value]) => {
        return columnRow(`${pc.dim(label.padEnd(width))}${" ".repeat(COLUMN_GAP + 1)}${value}`);
      }),
    ].join("\n");
  }
}

/**
 * Where a command may be broken across lines: at a space between two of its
 * arguments. A space inside quotes is not one of them, because `\` before a
 * newline is literal inside single quotes, so breaking there would change the
 * argument rather than continue the command. A `\` outside single quotes
 * escapes the next character, so `'\''` and `\ ` open no break.
 *
 * A quote only opens one where something closes it. An apostrophe reaches here
 * on its own — a sentence that names a command carries the words after it into
 * the command (`nextSteps`), and `the app's config` is one quote — and reading
 * it as an opening quote inverted the quote state for the rest
 * of the line. A quote does not open inside a word, so `it's` is not one.
 */
const argumentBreaks = (command: string): number[] => {
  const at: number[] = [];
  let quote: string | undefined;
  let escaped = false;
  // Indexes are UTF-16 units, as `slice` reads them; quotes and spaces are never half a pair.
  for (let index = 0; index < command.length; index += 1) {
    const character = command.charAt(index);
    if (escaped) {
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote !== undefined) {
      quote = character === quote ? undefined : quote;
    } else if (
      (character === "'" || character === '"') &&
      !/[\p{L}\p{N}]/u.test(command.charAt(index - 1)) &&
      command.includes(character, index + 1)
    ) {
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
 * Lines break only at a space between two arguments, never inside quotes or
 * at an escaped space, and every line starts with `lead`: the shell reads the
 * indent as more of the space that already separated those arguments. Where
 * nothing is left to break at within `width`, the rest stays whole on its last
 * line and runs past it, since inside quotes `\`-newline is kept as written and
 * a break there would change the argument.
 *
 * @param command - The command, already quoted the way it is to be pasted.
 * @param width - The columns each line may take, `lead` included.
 * @param lead - What each line starts with, such as the indent of a frame.
 * @returns The lines, each but the last ending in ` \`; a single line when the
 *   command fits or has no space to break at.
 */
export const wrapCommand = (command: string, width: number, lead = ""): string[] => {
  const lines: string[] = [];
  let rest = command;
  let indent = lead;
  while (indent.length + rest.length > width) {
    const cut = argumentBreaks(rest)
      .filter((at) => {
        return at > 0 && at <= Math.max(1, width - indent.length - 2);
      })
      .at(-1);
    if (cut === undefined) {
      break;
    }
    lines.push(`${indent}${rest.slice(0, cut)} \\`);
    rest = rest.slice(cut + 1);
    indent = lead;
  }
  return [...lines, `${indent}${rest}`];
};

/**
 * A rounded green frame round `text`, with `title` set into the top border: with
 * a column of padding either side, measured in the columns a terminal shows
 * rather than in code units, so a line holding double-width characters does
 * not leave its right border out of line.
 */
export const drawBox = (
  text: string,
  title: string,
  paint: (text: string) => string = pc.green,
): string => {
  const padding = 2;
  const edge = (character: string): string => {
    return paint(character);
  };
  const lines = text.split("\n");
  const width = Math.max(...lines.map(visible), visible(title)) + padding;
  const left = Math.floor((width - visible(title)) / 2);
  const blank = `\u0020${edge("\u2502")}${" ".repeat(width + padding)}${edge("\u2502")}`;
  return [
    `\u0020${edge("\u256d")}${edge("\u2500").repeat(left)}${paint(title)}${edge("\u2500").repeat(width - visible(title) - left + padding)}${edge("\u256e")}`,
    blank,
    ...lines.map((line) => {
      return `\u0020${edge("\u2502")}${" ".repeat(padding)}${line}${" ".repeat(width - visible(line))}${edge("\u2502")}`;
    }),
    blank,
    `\u0020${edge("\u2570")}${edge("\u2500").repeat(width + padding)}${edge("\u256f")}`,
    "",
  ].join("\n");
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
      ...this.steps.map((step) => {
        return this.step(step);
      }),
      ...(this.footer === undefined ? [] : [new Prose(this.footer, Frame.INNER, false).render()]),
    ];
    const lines = blocks.join("\n\n").split("\n");
    const last = lines.length - 1;
    const tail = lines[last] ?? "";
    lines[last] = `${tail}${" ".repeat(Math.max(0, Frame.INNER - visible(tail)))}`;
    return drawBox(lines.join("\n"), this.title);
  }

  private step(step: BoxAction): string {
    return [
      new Prose(step.text, Frame.INNER, false).render(),
      ...(step.command === undefined
        ? []
        : step.command
            .split("\n")
            .flatMap((command) => {
              return wrapCommand(command, Frame.INNER, "  ");
            })
            .map((line) => {
              return pc.bold(pc.cyan(line));
            })),
    ].join("\n");
  }
}
