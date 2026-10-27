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
 * Prose, wrapped to a width. A wrapped line keeps the indent of its first line,
 * plus two more for a list item (`[ok] …`, `$ …`, `- …`), so what belongs to one
 * item stays visibly under it. A line laid out in columns, such as a table row,
 * is left whole: breaking it would break the columns.
 */
export class Prose implements Renderable {
  private readonly text: string;
  private readonly width: number;

  constructor(text: string, width: number) {
    this.text = text;
    this.width = width;
  }

  render(): string {
    return this.text
      .split("\n")
      .map((line) => this.wrap(line))
      .join("\n");
  }

  private wrap(line: string): string {
    if (/\S {2,}\S/.test(line) || visible(line) <= this.width) {
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
    return [
      ...(section.heading === undefined ? [] : [pc.bold(section.heading)]),
      ...section.facts.map(([label, value]) => `${pc.dim(label.padEnd(width))}   ${value}`),
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
      ...(this.body.length === 0 ? [] : [new Prose(this.body.join("\n"), Frame.INNER).render()]),
      ...this.steps.map((step) => this.step(step)),
      ...(this.footer === undefined ? [] : [new Prose(this.footer, Frame.INNER).render()]),
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
      new Prose(step.text, Frame.INNER).render(),
      ...(step.command === undefined
        ? []
        : step.command.split("\n").map((command) => `  ${pc.bold(pc.cyan(command))}`)),
    ].join("\n");
  }
}
